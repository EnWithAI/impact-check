// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
/**
 * Analysis orchestrator: resolves revisions, collects git changes, builds snapshots and graphs, computes
 * impact, runs analyzers/rules and assembles the schema 2.0 report. Never executes repository code and never uses
 * the network. Snapshots are always cleaned up.
 */
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoError } from "../errors.js";
import { diff, isShallow, mergeBase, repoName, readPathsAt, repoRoot, resolveCommit, showFile, stagedPaths, unstagedPaths, unmergedPaths, untrackedFiles, validateRef, } from "../git/repo.js";
import { runGit, splitZ } from "../git/exec.js";
import { buildGraph } from "../graph/graph.js";
import { snapshotCommit, snapshotWorktree, MAX_FILE_BYTES } from "../snapshot/snapshot.js";
import { runRules } from "../rules/rules.js";
import { redactDeep } from "../report/redact.js";
import { DEFAULT_CONFIG, matchesAny } from "../config.js";
import { ENGINE_VERSION, PARSER_VERSION, TOOL_VERSION } from "../version.js";
import { isIgnoredDir, isJsTs, isUnsupportedModule, kindOf, languageOf } from "../util/classify.js";
import { SCHEMA_VERSION } from "../types.js";
import { computeImpact } from "./impact.js";
import { compareStrings, Limitations } from "./limitations.js";
import { suggestTests } from "./tests.js";
import { detectContext } from "../analyzers/context.js";
import { isGenerated } from "../analyzers/generated.js";
import { findSpecifierLine } from "../graph/lexical.js";
const MAX_RANGES_PER_FILE = 50;
/** Maximum number of changed files analyzed and listed; the rest are reported as a limitation. */
export const MAX_FILES_CHANGED = 5000;
const UNSUPPORTED_LANGUAGE = /\.(py|go|rb|java|kt|kts|rs|cs|php|swift|scala|c|cc|cpp|h|hpp|m|mm|dart|ex|exs|clj|lua|r|pl|sh)$/i;
const DEFAULT_BASES = ["main", "origin/main", "master", "origin/master"];
/** Resolves the base ref; without an explicit ref tries main, origin/main, master, origin/master. */
async function resolveBase(root, requested) {
    const candidates = requested === null ? DEFAULT_BASES : [validateRef(requested, "--base")];
    for (const ref of candidates) {
        const commit = await resolveCommit(root, ref);
        if (commit)
            return { ref, commit };
    }
    const shallow = await isShallow(root);
    throw repoError(requested === null
        ? `No base ref given and none of ${DEFAULT_BASES.join(", ")} exist`
        : `Base ref ${JSON.stringify(requested)} does not resolve to a commit`, shallow
        ? "This is a shallow clone. Fetch the base branch (e.g. `git fetch origin main --depth=50`, or `fetch-depth: 0` in actions/checkout)."
        : "Pass an existing branch, tag or commit with --base (e.g. --base origin/main), or fetch it first: git fetch origin main");
}
/** Number of lines in a buffer (a final line without newline counts). */
function lineCount(buffer) {
    if (buffer.length === 0)
        return 0;
    let n = 0;
    for (const byte of buffer)
        if (byte === 0x0a)
            n++;
    return buffer[buffer.length - 1] === 0x0a ? n : n + 1;
}
/** Line count and binary flag of an untracked file (regular files up to MAX_FILE_BYTES only). */
function readUntracked(root, path) {
    try {
        const stat = lstatSync(join(root, path));
        if (!stat.isFile() || stat.size > MAX_FILE_BYTES)
            return { binary: false, lines: null };
        const content = readFileSync(join(root, path));
        const binary = content.subarray(0, 8000).includes(0);
        return { binary, lines: binary ? null : lineCount(content) };
    }
    catch {
        return { binary: false, lines: null };
    }
}
/** Run the full deterministic analysis. Never executes repository code and never uses the network. */
export async function analyze(options) {
    const config = options.config ?? DEFAULT_CONFIG;
    const maxDepth = options.maxDepth ?? config.maxDepth;
    const maxAffected = options.maxAffected ?? config.maxAffected;
    const tsConfigOption = options.tsConfig ?? config.tsconfig;
    const log = options.log ?? (() => undefined);
    const limitations = new Limitations();
    const started = Date.now();
    const timings = {};
    let mark = started;
    const lap = (name) => {
        const now = Date.now();
        timings[name] = now - mark;
        mark = now;
    };
    const testPatterns = config.conventions.testPatterns;
    const kindFor = (path) => testPatterns.length > 0 && matchesAny(path, testPatterns) ? "test" : kindOf(path);
    const root = await repoRoot(options.cwd);
    const shallow = await isShallow(root);
    const base = await resolveBase(root, options.base ?? config.base);
    const worktreeMode = options.head === null;
    const headRef = worktreeMode ? "WORKTREE" : validateRef(options.head, "--head");
    const headCommit = await resolveCommit(root, worktreeMode ? "HEAD" : headRef);
    if (!headCommit) {
        throw repoError(worktreeMode
            ? "The repository has no commits yet (HEAD does not resolve)"
            : `Head ref ${JSON.stringify(headRef)} does not resolve to a commit`, worktreeMode ? "Create an initial commit first." : "Pass an existing branch, tag or commit with --head.");
    }
    let from = base.commit;
    let mergeBaseCommit = null;
    if (options.diffMode === "merge-base") {
        mergeBaseCommit = await mergeBase(root, base.commit, headCommit);
        if (!mergeBaseCommit) {
            throw repoError(`No merge base between ${base.ref} and ${worktreeMode ? "HEAD" : headRef}`, shallow
                ? "This is a shallow clone; history needed for the merge base is missing. Use `fetch-depth: 0` (actions/checkout) or `git fetch --unshallow`."
                : "The refs share no history. Use --diff-mode direct to compare them directly.");
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
        limitations.addCount("dirty-worktree-excluded", `Commit mode: ${dirty} uncommitted path(s) (staged ${staged.length}, unstaged ${unstaged.length}, untracked ${untracked.length}) were excluded. Omit --head to analyze the working tree.`, dirty);
    }
    let committed = new Set();
    if (worktreeMode) {
        const names = await runGit([
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
        ], { cwd: root });
        committed = new Set(splitZ(names.stdout));
    }
    const stagedSet = new Set(staged);
    const unstagedSet = new Set(unstaged);
    const originOf = (path) => {
        if (!worktreeMode)
            return "committed";
        const buckets = [committed.has(path), stagedSet.has(path), unstagedSet.has(path)].filter(Boolean).length;
        if (buckets > 1)
            return "mixed";
        if (stagedSet.has(path))
            return "staged";
        if (unstagedSet.has(path))
            return "unstaged";
        return "committed";
    };
    const ignored = [];
    const files = [];
    for (const change of result.changes) {
        if (config.ignorePaths.length > 0 && matchesAny(change.path, config.ignorePaths)) {
            ignored.push(change.path);
            continue;
        }
        const stats = result.numstat.get(change.path);
        const hunks = result.hunks.get(change.path);
        if (hunks?.truncated)
            limitations.add("diff-truncated", "Very large diffs were only partially inspected by line-based rules.", change.path);
        files.push({
            path: change.path,
            previous_path: change.previousPath,
            status: worktreeMode && unmerged.has(change.path) ? "unmerged" : change.status,
            binary: stats?.binary ?? false,
            generated: false,
            language: languageOf(change.path),
            kind: kindFor(change.path),
            additions: stats?.additions ?? null,
            deletions: stats?.deletions ?? null,
            origin: originOf(change.path),
            changed_lines: change.status === "deleted" ? [] : (hunks?.ranges ?? []).slice(0, MAX_RANGES_PER_FILE),
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
                previous_path: null,
                status: "added",
                binary: info.binary,
                generated: false,
                language: languageOf(path),
                kind: kindFor(path),
                additions: info.lines,
                deletions: info.lines === null ? null : 0,
                origin: "untracked",
                changed_lines: info.lines ? [{ start: 1, end: info.lines }] : [],
                provenance: "observed",
            });
        }
        if (untrackedDeps > 0) {
            limitations.addCount("untracked-node-modules-skipped", "Untracked files inside node_modules/ (not covered by .gitignore) were not listed or analyzed.", untrackedDeps);
        }
    }
    files.sort((a, b) => compareStrings(a.path, b.path));
    if (files.length > MAX_FILES_CHANGED) {
        limitations.addCount("files-changed-truncated", `More than ${MAX_FILES_CHANGED} files changed; only the first ${MAX_FILES_CHANGED} (sorted by path) were analyzed and listed.`, files.length - MAX_FILES_CHANGED);
        files.length = MAX_FILES_CHANGED;
    }
    for (const path of ignored.sort(compareStrings))
        limitations.add("ignored-by-config", "Changed paths excluded by `ignorePaths` in the config.", path);
    for (const file of files) {
        if (file.binary)
            limitations.add("binary-file", "Binary files are listed but their contents are not analyzed.", file.path);
        if (file.status === "unmerged")
            limitations.add("unmerged-paths", "Conflicted (unmerged) paths cannot be analyzed reliably; resolve conflicts first.", file.path);
        if (isUnsupportedModule(file.path))
            limitations.add("unsupported-file-type", "Component formats such as .vue/.svelte/.astro are not parsed in alpha; their imports are not in the graph.", file.path);
        else if (UNSUPPORTED_LANGUAGE.test(file.path))
            limitations.add("unsupported-language", "Changed files in languages other than JavaScript/TypeScript are listed but not analyzed.", file.path);
    }
    // --- Snapshots and graphs ----------------------------------------------------------------------------------
    const snapshots = [];
    try {
        log("Materializing head snapshot");
        const headSnapshot = worktreeMode ? await snapshotWorktree(root) : await snapshotCommit(root, headCommit);
        snapshots.push(headSnapshot);
        limitations.merge(headSnapshot.limitations);
        lap("git_and_snapshot");
        for (const file of files) {
            if (file.status === "deleted")
                continue;
            if (isGenerated(file.path, headSnapshot.read(file.path), config.conventions.generatedPaths)) {
                file.generated = true;
                limitations.add("generated-code", "Changed files look generated (marker, path convention or conventions.generatedPaths). Review the generator input; findings on generated code reflect generator output.", file.path);
            }
        }
        log(`Building head dependency graph (${headSnapshot.files.length} files)`);
        const head = await buildGraph(headSnapshot, { tsConfig: tsConfigOption, side: "head" }, limitations);
        const needsBase = files.some((f) => (f.status === "deleted" && isJsTs(f.path)) ||
            (f.status === "renamed" && f.previous_path !== null && isJsTs(f.previous_path)));
        let baseGraph = null;
        let baseSnapshot = null;
        if (needsBase) {
            log("Building base dependency graph (modules were deleted or renamed)");
            baseSnapshot = await snapshotCommit(root, from);
            snapshots.push(baseSnapshot);
            baseGraph = await buildGraph(baseSnapshot, { tsConfig: tsConfigOption, side: "base" }, limitations);
        }
        // --- Impact ----------------------------------------------------------------------------------------------
        const headNodes = new Set([...head.modules, ...headSnapshot.files, ...headSnapshot.placeholders]);
        const roots = [];
        const extraReverse = new Map();
        for (const file of files) {
            if (file.status !== "deleted" &&
                headNodes.has(file.path) &&
                (isJsTs(file.path) || head.rdeps.has(file.path)))
                roots.push(file.path);
            const oldPath = file.status === "deleted" ? file.path : file.status === "renamed" ? file.previous_path : null;
            if (oldPath !== null && baseGraph && isJsTs(oldPath)) {
                const dependents = [...(baseGraph.rdeps.get(oldPath) ?? [])].filter((d) => headNodes.has(d));
                roots.push(oldPath);
                extraReverse.set(oldPath, dependents);
            }
        }
        lap("graph");
        const degraded = head.stats.modules === 0;
        if (degraded) {
            limitations.add("no-dependency-graph", "No JavaScript/TypeScript modules were found, so no dependency graph exists. Only observed file changes are reported; no impact on other modules is claimed.");
        }
        const impact = computeImpact({ graph: head, roots, extraReverse, maxDepth, maxAffected });
        // Evidence-linked consumers: the import edge from each dependent to the previous module of its `via` chain.
        const headEvidenceCommit = worktreeMode ? null : headCommit;
        for (const mod of impact.affected) {
            if (mod.reason !== "dependent")
                continue;
            const previous = mod.via[mod.via.length - 2];
            const headEdge = head.deps.get(mod.path)?.get(previous);
            const baseEdge = headEdge ? undefined : baseGraph?.deps.get(mod.path)?.get(previous);
            const edge = headEdge ?? baseEdge;
            if (!edge)
                continue;
            const side = headEdge ? "head" : "base";
            const text = (side === "head" ? headSnapshot.read(mod.path) : baseSnapshot?.read(mod.path)) ?? "";
            mod.evidence = edge.specifiers.map((spec) => {
                const line = findSpecifierLine(text, spec);
                return {
                    kind: "import-edge",
                    path: mod.path,
                    side,
                    line_start: line,
                    line_end: line,
                    commit: side === "head" ? headEvidenceCommit : from,
                    detail: `imports "${spec}" → ${previous}${edge.provenance === "inferred" ? " (inferred workspace mapping)" : ""}`,
                };
            });
        }
        if (impact.truncated) {
            limitations.add("graph-truncated", `More than ${maxAffected} dependent modules were found; the list was truncated (raise --max-affected).`);
        }
        if (impact.depthLimited) {
            limitations.add("depth-limit-reached", `Reverse dependencies were followed for at most ${maxDepth} hops (raise --max-depth).`);
        }
        if (head.external.size > 0) {
            limitations.add("external-packages-not-analyzed", "Imports of npm packages and Node built-ins are not followed; changes inside dependencies are out of scope.");
        }
        limitations.add("semantic-analysis-not-performed", "Impact Check analyzes module-level imports and diff lines. It does not type-check, evaluate behavior or prove compatibility.");
        limitations.add("tests-not-executed", "Suggested tests are candidates only. Impact Check never runs tests or package scripts.");
        // --- Rules and tests -------------------------------------------------------------------------------------
        // Prefetch base-side text of modified/renamed JS/TS modules and manifests in one git process.
        const baseTexts = await readPathsAt(root, from, files
            .filter((f) => (f.status === "modified" || f.status === "renamed") &&
            (isJsTs(f.path) || f.path.endsWith("package.json")))
            .map((f) => f.previous_path ?? f.path));
        const findings = await runRules({
            files,
            hunks: result.hunks,
            head,
            base: baseGraph,
            headSnapshot,
            readBase: async (path) => {
                const buffer = baseTexts.has(path) ? baseTexts.get(path) : await showFile(root, from, path);
                return buffer && buffer.length <= MAX_FILE_BYTES ? buffer.toString("utf8") : null;
            },
            dependentCounts: impact.dependentCounts,
            blastRadiusThreshold: config.blastRadiusThreshold,
            maxDepth,
            securityPathPatterns: config.securityPathPatterns,
            limitations,
        });
        for (const finding of findings) {
            for (const e of finding.evidence)
                e.commit = e.side === "base" ? from : headEvidenceCommit;
        }
        const suggestedTests = suggestTests(files, impact.affected, headSnapshot.files, (p) => kindFor(p) === "test");
        lap("rules");
        const coverageLimitations = limitations.toArray();
        const bySeverity = { high: 0, medium: 0, low: 0, info: 0 };
        const byStatus = { verified_static_fact: 0, hypothesis: 0, unknown: 0 };
        for (const f of findings) {
            bySeverity[f.severity]++;
            byStatus[f.status]++;
        }
        const report = {
            schema_version: SCHEMA_VERSION,
            repo_revision: {
                ref: headRef,
                commit: headCommit,
                kind: worktreeMode ? "worktree" : "commit",
                worktree: { included: worktreeMode, ...worktreeCounts },
            },
            base_revision: {
                ref: base.ref,
                commit: base.commit,
                merge_base: mergeBaseCommit,
                diff_mode: options.diffMode,
            },
            repository: {
                name: repoName(root),
                is_shallow: shallow,
                ts_config: head.tsConfig,
                workspace_packages: head.packages.map((p) => ({ name: p.name, path: p.dir || "." })),
                context: detectContext(headSnapshot, head.tsConfig),
            },
            summary: {
                analysis_mode: degraded ? "degraded" : "full",
                files_changed: files.length,
                js_ts_files_changed: files.filter((f) => isJsTs(f.path)).length,
                affected_modules: impact.affected.length,
                findings_by_severity: bySeverity,
                findings_by_status: byStatus,
                test_candidates: suggestedTests.length,
                coverage_limitations: coverageLimitations.length,
            },
            changed_files: files,
            affected_modules: impact.affected,
            findings,
            test_candidates: suggestedTests,
            coverage_limitations: coverageLimitations,
            run_metadata: {
                tool: "impact-check",
                tool_version: TOOL_VERSION,
                generated_at: (options.now ?? (() => new Date()))().toISOString(),
                duration_ms: Date.now() - started,
                timings_ms: timings,
                node_version: process.version,
                engine: "dependency-cruiser",
                engine_version: ENGINE_VERSION,
                parser_version: PARSER_VERSION,
                head_graph: head.stats,
                base_graph: baseGraph?.stats ?? null,
                limits: { max_depth: maxDepth, max_affected: maxAffected, truncated: impact.truncated },
                config_source: options.configSource ?? "defaults",
                network: false,
                executed_repository_code: false,
                model_usage: null,
                review_effort: {
                    files_to_review: files.length,
                    findings_requiring_human_action: findings.filter((f) => f.severity !== "info").length,
                    test_candidates: suggestedTests.length,
                },
            },
        };
        return redactDeep(report, new Set(["commit", "merge_base", "id", "generated_at", "node_version"]));
    }
    finally {
        for (const snapshot of snapshots)
            snapshot.cleanup();
    }
}
