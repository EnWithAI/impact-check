import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoError } from "../errors.js";
import {
  diff,
  isShallow,
  mergeBase,
  repoName,
  repoRoot,
  resolveCommit,
  showFile,
  stagedPaths,
  unstagedPaths,
  unmergedPaths,
  untrackedFiles,
  validateRef,
  type FileHunks,
} from "../git/repo.js";
import { runGit, splitZ } from "../git/exec.js";
import { buildGraph, type ModuleGraph } from "../graph/graph.js";
import { snapshotCommit, snapshotWorktree, MAX_FILE_BYTES, type Snapshot } from "../snapshot/snapshot.js";
import { runRules } from "../rules/rules.js";
import { redactDeep } from "../report/redact.js";
import { DEFAULT_CONFIG, matchesAny, type Config } from "../config.js";
import { ENGINE_VERSION, PARSER_VERSION, TOOL_VERSION } from "../version.js";
import { isIgnoredDir, isJsTs, isUnsupportedModule, kindOf, languageOf } from "../util/classify.js";
import type { ChangedFile, Origin, Report } from "../types.js";
import { SCHEMA_VERSION } from "../types.js";
import { computeImpact } from "./impact.js";
import { compareStrings, Limitations } from "./limitations.js";
import { suggestTests } from "./tests.js";

export interface AnalyzeOptions {
  cwd: string;
  /** Base ref; null = config or default ("main", falling back to origin/main, master, origin/master). */
  base: string | null;
  /** Head ref; null = analyze the working tree. */
  head: string | null;
  diffMode: "merge-base" | "direct";
  maxDepth?: number;
  maxAffected?: number;
  tsConfig?: string | null;
  config?: Config;
  now?: () => Date;
  log?: (message: string) => void;
}

const MAX_RANGES_PER_FILE = 50;
export const MAX_FILES_CHANGED = 5000;
const UNSUPPORTED_LANGUAGE =
  /\.(py|go|rb|java|kt|kts|rs|cs|php|swift|scala|c|cc|cpp|h|hpp|m|mm|dart|ex|exs|clj|lua|r|pl|sh)$/i;
const DEFAULT_BASES = ["main", "origin/main", "master", "origin/master"];

async function resolveBase(root: string, requested: string | null): Promise<{ ref: string; commit: string }> {
  const candidates = requested === null ? DEFAULT_BASES : [validateRef(requested, "--base")];
  for (const ref of candidates) {
    const commit = await resolveCommit(root, ref);
    if (commit) return { ref, commit };
  }
  const shallow = await isShallow(root);
  throw repoError(
    requested === null
      ? `No base ref given and none of ${DEFAULT_BASES.join(", ")} exist`
      : `Base ref ${JSON.stringify(requested)} does not resolve to a commit`,
    shallow
      ? "This is a shallow clone. Fetch the base branch (e.g. `git fetch origin main --depth=50`, or `fetch-depth: 0` in actions/checkout)."
      : "Pass an existing branch, tag or commit with --base (e.g. --base origin/main), or fetch it first: git fetch origin main"
  );
}

function lineCount(buffer: Buffer): number {
  if (buffer.length === 0) return 0;
  let n = 0;
  for (const byte of buffer) if (byte === 0x0a) n++;
  return buffer[buffer.length - 1] === 0x0a ? n : n + 1;
}

function readUntracked(root: string, path: string): { binary: boolean; lines: number | null } {
  try {
    const stat = lstatSync(join(root, path));
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return { binary: false, lines: null };
    const content = readFileSync(join(root, path));
    const binary = content.subarray(0, 8000).includes(0);
    return { binary, lines: binary ? null : lineCount(content) };
  } catch {
    return { binary: false, lines: null };
  }
}

/** Run the full deterministic analysis. Never executes repository code and never uses the network. */
export async function analyze(options: AnalyzeOptions): Promise<Report> {
  const config = options.config ?? DEFAULT_CONFIG;
  const maxDepth = options.maxDepth ?? config.maxDepth;
  const maxAffected = options.maxAffected ?? config.maxAffected;
  const tsConfigOption = options.tsConfig ?? config.tsconfig;
  const log = options.log ?? (() => undefined);
  const limitations = new Limitations();

  const root = await repoRoot(options.cwd);
  const shallow = await isShallow(root);
  const base = await resolveBase(root, options.base ?? config.base);

  const worktreeMode = options.head === null;
  const headRef = worktreeMode ? "WORKTREE" : validateRef(options.head as string, "--head");
  const headCommit = await resolveCommit(root, worktreeMode ? "HEAD" : headRef);
  if (!headCommit) {
    throw repoError(
      worktreeMode
        ? "The repository has no commits yet (HEAD does not resolve)"
        : `Head ref ${JSON.stringify(headRef)} does not resolve to a commit`,
      worktreeMode ? "Create an initial commit first." : "Pass an existing branch, tag or commit with --head."
    );
  }

  let from = base.commit;
  let mergeBaseCommit: string | null = null;
  if (options.diffMode === "merge-base") {
    mergeBaseCommit = await mergeBase(root, base.commit, headCommit);
    if (!mergeBaseCommit) {
      throw repoError(
        `No merge base between ${base.ref} and ${worktreeMode ? "HEAD" : headRef}`,
        shallow
          ? "This is a shallow clone; history needed for the merge base is missing. Use `fetch-depth: 0` (actions/checkout) or `git fetch --unshallow`."
          : "The refs share no history. Use --diff-mode direct to compare them directly."
      );
    }
    from = mergeBaseCommit;
  }
  log(`Comparing ${from.slice(0, 12)} → ${worktreeMode ? "working tree" : headCommit.slice(0, 12)}`);

  // --- Git changes -------------------------------------------------------------------------------------------
  const [result, staged, unstaged, untracked, unmerged] = await Promise.all([
    diff(root, from, worktreeMode ? null : headCommit),
    stagedPaths(root),
    unstagedPaths(root),
    untrackedFiles(root),
    unmergedPaths(root),
  ]);
  const worktreeCounts = { staged: staged.length, unstaged: unstaged.length, untracked: untracked.length };
  const dirty = staged.length + unstaged.length + untracked.length;
  if (!worktreeMode && dirty > 0) {
    limitations.addCount(
      "dirty-worktree-excluded",
      `Commit mode: ${dirty} uncommitted path(s) (staged ${staged.length}, unstaged ${unstaged.length}, untracked ${untracked.length}) were excluded. Omit --head to analyze the working tree.`,
      dirty
    );
  }

  let committed = new Set<string>();
  if (worktreeMode) {
    const names = await runGit(
      [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--find-renames",
        "--name-only",
        "-z",
        "--end-of-options",
        from,
        headCommit,
        "--",
      ],
      { cwd: root }
    );
    committed = new Set(splitZ(names.stdout));
  }
  const stagedSet = new Set(staged);
  const unstagedSet = new Set(unstaged);
  const originOf = (path: string): Origin => {
    if (!worktreeMode) return "committed";
    const buckets = [committed.has(path), stagedSet.has(path), unstagedSet.has(path)].filter(Boolean).length;
    if (buckets > 1) return "mixed";
    if (stagedSet.has(path)) return "staged";
    if (unstagedSet.has(path)) return "unstaged";
    return "committed";
  };

  const ignored: string[] = [];
  const files: ChangedFile[] = [];
  for (const change of result.changes) {
    if (config.ignorePaths.length > 0 && matchesAny(change.path, config.ignorePaths)) {
      ignored.push(change.path);
      continue;
    }
    const stats = result.numstat.get(change.path);
    const hunks: FileHunks | undefined = result.hunks.get(change.path);
    if (hunks?.truncated)
      limitations.add(
        "diff-truncated",
        "Very large diffs were only partially inspected by line-based rules.",
        change.path
      );
    files.push({
      path: change.path,
      previousPath: change.previousPath,
      status: worktreeMode && unmerged.has(change.path) ? "unmerged" : change.status,
      binary: stats?.binary ?? false,
      language: languageOf(change.path),
      kind: kindOf(change.path),
      additions: stats?.additions ?? null,
      deletions: stats?.deletions ?? null,
      origin: originOf(change.path),
      changedLines: change.status === "deleted" ? [] : (hunks?.ranges ?? []).slice(0, MAX_RANGES_PER_FILE),
      provenance: "observed",
    });
  }
  if (worktreeMode) {
    let untrackedDeps = 0;
    for (const path of untracked) {
      if (isIgnoredDir(path)) {
        untrackedDeps++;
        continue;
      }
      if (config.ignorePaths.length > 0 && matchesAny(path, config.ignorePaths)) {
        ignored.push(path);
        continue;
      }
      const info = readUntracked(root, path);
      files.push({
        path,
        previousPath: null,
        status: "added",
        binary: info.binary,
        language: languageOf(path),
        kind: kindOf(path),
        additions: info.lines,
        deletions: info.lines === null ? null : 0,
        origin: "untracked",
        changedLines: info.lines ? [{ start: 1, end: info.lines }] : [],
        provenance: "observed",
      });
    }
    if (untrackedDeps > 0) {
      limitations.addCount(
        "untracked-node-modules-skipped",
        "Untracked files inside node_modules/ (not covered by .gitignore) were not listed or analyzed.",
        untrackedDeps
      );
    }
  }
  files.sort((a, b) => compareStrings(a.path, b.path));
  if (files.length > MAX_FILES_CHANGED) {
    limitations.addCount(
      "files-changed-truncated",
      `More than ${MAX_FILES_CHANGED} files changed; only the first ${MAX_FILES_CHANGED} (sorted by path) were analyzed and listed.`,
      files.length - MAX_FILES_CHANGED
    );
    files.length = MAX_FILES_CHANGED;
  }
  for (const path of ignored.sort(compareStrings))
    limitations.add("ignored-by-config", "Changed paths excluded by `ignorePaths` in the config.", path);

  for (const file of files) {
    if (file.binary)
      limitations.add(
        "binary-file",
        "Binary files are listed but their contents are not analyzed.",
        file.path
      );
    if (file.status === "unmerged")
      limitations.add(
        "unmerged-paths",
        "Conflicted (unmerged) paths cannot be analyzed reliably; resolve conflicts first.",
        file.path
      );
    if (isUnsupportedModule(file.path))
      limitations.add(
        "unsupported-file-type",
        "Component formats such as .vue/.svelte/.astro are not parsed in alpha; their imports are not in the graph.",
        file.path
      );
    else if (UNSUPPORTED_LANGUAGE.test(file.path))
      limitations.add(
        "unsupported-language",
        "Changed files in languages other than JavaScript/TypeScript are listed but not analyzed.",
        file.path
      );
  }

  // --- Snapshots and graphs ----------------------------------------------------------------------------------
  const snapshots: Snapshot[] = [];
  try {
    log("Materializing head snapshot");
    const headSnapshot = worktreeMode ? await snapshotWorktree(root) : await snapshotCommit(root, headCommit);
    snapshots.push(headSnapshot);
    limitations.merge(headSnapshot.limitations);

    log(`Building head dependency graph (${headSnapshot.files.length} files)`);
    const head = await buildGraph(headSnapshot, { tsConfig: tsConfigOption, side: "head" }, limitations);

    const needsBase = files.some(
      (f) =>
        (f.status === "deleted" && isJsTs(f.path)) ||
        (f.status === "renamed" && f.previousPath !== null && isJsTs(f.previousPath))
    );
    let baseGraph: ModuleGraph | null = null;
    if (needsBase) {
      log("Building base dependency graph (modules were deleted or renamed)");
      const baseSnapshot = await snapshotCommit(root, from);
      snapshots.push(baseSnapshot);
      baseGraph = await buildGraph(baseSnapshot, { tsConfig: tsConfigOption, side: "base" }, limitations);
    }

    // --- Impact ----------------------------------------------------------------------------------------------
    const headNodes = new Set([...head.modules, ...headSnapshot.files, ...headSnapshot.placeholders]);
    const roots: string[] = [];
    const extraReverse = new Map<string, string[]>();
    for (const file of files) {
      if (
        file.status !== "deleted" &&
        headNodes.has(file.path) &&
        (isJsTs(file.path) || head.rdeps.has(file.path))
      )
        roots.push(file.path);
      const oldPath =
        file.status === "deleted" ? file.path : file.status === "renamed" ? file.previousPath : null;
      if (oldPath !== null && baseGraph && isJsTs(oldPath)) {
        const dependents = [...(baseGraph.rdeps.get(oldPath) ?? [])].filter((d) => headNodes.has(d));
        roots.push(oldPath);
        extraReverse.set(oldPath, dependents);
      }
    }
    const impact = computeImpact({ graph: head, roots, extraReverse, maxDepth, maxAffected });
    if (impact.truncated) {
      limitations.add(
        "graph-truncated",
        `More than ${maxAffected} dependent modules were found; the list was truncated (raise --max-affected).`
      );
    }
    if (impact.depthLimited) {
      limitations.add(
        "depth-limit-reached",
        `Reverse dependencies were followed for at most ${maxDepth} hops (raise --max-depth).`
      );
    }
    if (head.external.size > 0) {
      limitations.add(
        "external-packages-not-analyzed",
        "Imports of npm packages and Node built-ins are not followed; changes inside dependencies are out of scope."
      );
    }
    limitations.add(
      "semantic-analysis-not-performed",
      "ChangeLens analyzes module-level imports and diff lines. It does not type-check, evaluate behavior or prove compatibility."
    );
    limitations.add(
      "tests-not-executed",
      "Suggested tests are candidates only. ChangeLens never runs tests or package scripts."
    );

    // --- Rules and tests -------------------------------------------------------------------------------------
    const findings = await runRules({
      files,
      hunks: result.hunks,
      head,
      base: baseGraph,
      headSnapshot,
      readBase: async (path) => {
        const buffer = await showFile(root, from, path);
        return buffer && buffer.length <= MAX_FILE_BYTES ? buffer.toString("utf8") : null;
      },
      dependentCounts: impact.dependentCounts,
      blastRadiusThreshold: config.blastRadiusThreshold,
      maxDepth,
      securityPathPatterns: config.securityPathPatterns,
    });
    const suggestedTests = suggestTests(files, impact.affected, headSnapshot.files);
    const coverageLimitations = limitations.toArray();

    const bySeverity = { high: 0, medium: 0, low: 0, info: 0 };
    for (const f of findings) bySeverity[f.severity]++;

    const report: Report = {
      schemaVersion: SCHEMA_VERSION,
      toolVersion: TOOL_VERSION,
      generatedAt: (options.now ?? (() => new Date()))().toISOString(),
      repository: {
        name: repoName(root),
        isShallow: shallow,
        tsConfig: head.tsConfig,
        workspacePackages: head.packages.map((p) => ({ name: p.name, path: p.dir || "." })),
      },
      comparison: {
        baseRef: base.ref,
        baseCommit: base.commit,
        mergeBase: mergeBaseCommit,
        diffMode: options.diffMode,
        headRef,
        headCommit,
        headKind: worktreeMode ? "worktree" : "commit",
        worktree: { included: worktreeMode, ...worktreeCounts },
      },
      summary: {
        filesChanged: files.length,
        jsTsFilesChanged: files.filter((f) => isJsTs(f.path)).length,
        affectedModules: impact.affected.length,
        findingsBySeverity: bySeverity,
        suggestedTests: suggestedTests.length,
        coverageLimitations: coverageLimitations.length,
      },
      filesChanged: files,
      affectedModules: impact.affected,
      riskFindings: findings,
      suggestedTests,
      coverageLimitations,
      analysis: {
        engine: "dependency-cruiser",
        engineVersion: ENGINE_VERSION,
        parserVersion: PARSER_VERSION,
        headGraph: head.stats,
        baseGraph: baseGraph?.stats ?? null,
        limits: { maxDepth, maxAffected, truncated: impact.truncated },
        network: false,
        executedRepositoryCode: false,
      },
    };
    return redactDeep(report, new Set(["baseCommit", "headCommit", "mergeBase", "id", "generatedAt"]));
  } finally {
    for (const snapshot of snapshots) snapshot.cleanup();
  }
}
