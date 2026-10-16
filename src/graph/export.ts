// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
/**
 * `impact-check graph`: the module graph of one revision (head commit or working tree) as a JSON document for other
 * Commons tools (docs/GRAPH.md, schema/impact-check-graph.schema.json). Uses the same snapshot and dependency-cruiser
 * setup as `analyze`; never executes repository code and never uses the network.
 */
import { repoError } from "../errors.js";
import {
  repoName,
  repoRoot,
  resolveCommit,
  stagedPaths,
  unstagedPaths,
  untrackedFiles,
  validateRef,
} from "../git/repo.js";
import { compareStrings, Limitations } from "../analysis/limitations.js";
import { DEFAULT_CONFIG, matchesAny, type Config } from "../config.js";
import { redactDeep } from "../report/redact.js";
import { snapshotCommit, snapshotWorktree } from "../snapshot/snapshot.js";
import type { FileKind, GraphStats, Language, Limitation } from "../types.js";
import { kindOf, languageOf } from "../util/classify.js";
import { ENGINE_VERSION, PARSER_VERSION, TOOL_VERSION } from "../version.js";
import { buildGraph } from "./graph.js";
import { findSpecifierLine } from "./lexical.js";

/** Graph document version (independent of the report schema). */
export const GRAPH_SCHEMA_VERSION = "1.0" as const;

/** One import specifier and the first line that contains it. */
export interface GraphImport {
  specifier: string;
  line: number | null;
}

/** An import that is not a resolved local edge (unresolved local, npm package or Node built-in). */
export interface GraphModuleImport extends GraphImport {
  from: string;
}

/** The `impact-check graph --format json` document (graph schema 1.0). */
export interface GraphExport {
  schema_version: typeof GRAPH_SCHEMA_VERSION;
  repo_revision: { ref: string; commit: string; kind: "commit" | "worktree" };
  repository: {
    name: string;
    ts_config: string | null;
    workspace_packages: { name: string; path: string }[];
  };
  modules: { path: string; language: Language; kind: FileKind; package: string | null }[];
  edges: {
    from: string;
    to: string;
    provenance: "graph" | "inferred";
    type_only: boolean;
    imports: GraphImport[];
  }[];
  unresolved_imports: GraphModuleImport[];
  external_imports: GraphModuleImport[];
  stats: GraphStats;
  coverage_limitations: Limitation[];
  run_metadata: {
    tool: "impact-check";
    tool_version: string;
    generated_at: string;
    node_version: string;
    engine: "dependency-cruiser";
    engine_version: string;
    parser_version: string;
    network: false;
    executed_repository_code: false;
  };
}

/** Options for exportGraph(). */
export interface GraphOptions {
  cwd: string;
  /** Head ref; null = the working tree. */
  head: string | null;
  tsConfig?: string | null;
  config?: Config;
  now?: () => Date;
  log?: (message: string) => void;
}

/** Builds the module graph of one revision. */
export async function exportGraph(options: GraphOptions): Promise<GraphExport> {
  const config = options.config ?? DEFAULT_CONFIG;
  const log = options.log ?? (() => undefined);
  const limitations = new Limitations();
  const root = await repoRoot(options.cwd);
  const worktree = options.head === null;
  const ref = worktree ? "WORKTREE" : validateRef(options.head as string, "--head");
  const commit = await resolveCommit(root, worktree ? "HEAD" : ref);
  if (!commit) {
    throw repoError(
      worktree
        ? "The repository has no commits yet (HEAD does not resolve)"
        : `Head ref ${JSON.stringify(ref)} does not resolve to a commit`,
      worktree ? "Create an initial commit first." : "Pass an existing branch, tag or commit with --head."
    );
  }
  if (!worktree) {
    const [staged, unstaged, untracked] = await Promise.all([
      stagedPaths(root),
      unstagedPaths(root),
      untrackedFiles(root),
    ]);
    const dirty = staged.length + unstaged.length + untracked.length;
    if (dirty > 0) {
      limitations.addCount(
        "dirty-worktree-excluded",
        `Commit mode: ${dirty} uncommitted path(s) were excluded. Omit --head to export the working tree.`,
        dirty
      );
    }
  }

  log(`Materializing ${worktree ? "working tree" : commit.slice(0, 12)} snapshot`);
  const snapshot = worktree ? await snapshotWorktree(root) : await snapshotCommit(root, commit);
  try {
    limitations.merge(snapshot.limitations);
    const graph = await buildGraph(
      snapshot,
      { tsConfig: options.tsConfig ?? config.tsconfig, side: "head" },
      limitations
    );
    const testPatterns = config.conventions.testPatterns;
    const kindFor = (path: string): FileKind =>
      testPatterns.length > 0 && matchesAny(path, testPatterns) ? "test" : kindOf(path);
    // Innermost package first: packages sorted by directory length, longest first.
    const packages = [...graph.packages].sort((a, b) => b.dir.length - a.dir.length);
    const packageOf = (path: string): string | null =>
      packages.find((p) => p.dir === "" || path.startsWith(`${p.dir}/`))?.name ?? null;
    const texts = new Map<string, string>();
    const lineOf = (from: string, specifier: string): number | null => {
      if (!texts.has(from)) texts.set(from, snapshot.read(from) ?? "");
      return findSpecifierLine(texts.get(from) as string, specifier);
    };
    const imports = (map: Map<string, string[]>, literal: boolean): GraphModuleImport[] =>
      [...map.entries()]
        .flatMap(([from, specs]) =>
          specs.map((spec) => {
            // The resolver reports Node built-ins without "node:"; keep the specifier as written.
            const written =
              literal && lineOf(from, spec) === null && lineOf(from, `node:${spec}`) !== null
                ? `node:${spec}`
                : spec;
            return { from, specifier: written, line: lineOf(from, written) };
          })
        )
        .sort((a, b) => compareStrings(a.from, b.from) || compareStrings(a.specifier, b.specifier));

    const out: GraphExport = {
      schema_version: GRAPH_SCHEMA_VERSION,
      repo_revision: { ref, commit, kind: worktree ? "worktree" : "commit" },
      repository: {
        name: repoName(root),
        ts_config: graph.tsConfig,
        workspace_packages: graph.packages.map((p) => ({ name: p.name, path: p.dir || "." })),
      },
      modules: [...graph.modules].sort(compareStrings).map((path) => ({
        path,
        language: languageOf(path),
        kind: kindFor(path),
        package: packageOf(path),
      })),
      edges: [...graph.deps.entries()]
        .flatMap(([from, targets]) =>
          [...targets.entries()].map(([to, edge]) => ({
            from,
            to,
            provenance: edge.provenance,
            type_only: edge.typeOnly,
            imports: edge.specifiers.map((specifier) => ({ specifier, line: lineOf(from, specifier) })),
          }))
        )
        .sort((a, b) => compareStrings(a.from, b.from) || compareStrings(a.to, b.to)),
      unresolved_imports: imports(graph.unresolvedLocal, false),
      external_imports: imports(graph.external, true),
      stats: graph.stats,
      coverage_limitations: limitations.toArray(),
      run_metadata: {
        tool: "impact-check",
        tool_version: TOOL_VERSION,
        generated_at: (options.now ?? (() => new Date()))().toISOString(),
        node_version: process.version,
        engine: "dependency-cruiser",
        engine_version: ENGINE_VERSION,
        parser_version: PARSER_VERSION,
        network: false,
        executed_repository_code: false,
      },
    };
    return redactDeep(out, new Set(["commit", "generated_at", "node_version"]));
  } finally {
    snapshot.cleanup();
  }
}
