import { cruise } from "dependency-cruiser";
import extractTSConfig from "dependency-cruiser/config-utl/extract-ts-config";
import type { Limitations } from "../analysis/limitations.js";
import { compareStrings } from "../analysis/limitations.js";
import type { Snapshot } from "../snapshot/snapshot.js";
import type { GraphStats } from "../types.js";
import { isJsTs } from "../util/classify.js";
import { findPackages, resolveWorkspaceSpecifier, type WorkspacePackage } from "./workspaces.js";
import { scanNonLiteralImports } from "./lexical.js";

export interface Edge {
  specifiers: string[];
  provenance: "graph" | "inferred";
  typeOnly: boolean;
}

export interface ModuleGraph {
  /** All module nodes (JS/TS sources and resolved non-JS targets such as JSON/CSS). */
  modules: Set<string>;
  deps: Map<string, Map<string, Edge>>;
  rdeps: Map<string, Set<string>>;
  /** Local (relative/aliased) imports that could not be resolved, per importing module. */
  unresolvedLocal: Map<string, string[]>;
  /** External package specifiers per module (bare imports not matching a workspace package). */
  external: Map<string, string[]>;
  packages: WorkspacePackage[];
  tsConfig: string | null;
  stats: GraphStats;
}

interface CruiseDependency {
  module: string;
  resolved: string;
  couldNotResolve: boolean;
  coreModule: boolean;
  dependencyTypes: string[];
}

interface CruiseModule {
  source: string;
  dependencies: CruiseDependency[];
  couldNotResolve?: boolean;
  coreModule?: boolean;
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../") || specifier === "." || specifier === "..";
}

function tsconfigAliasPrefixes(text: string | null): string[] {
  if (!text) return [];
  // tsconfig is JSONC; extract "paths" keys conservatively without evaluating anything.
  const match = /"paths"\s*:\s*\{([\s\S]*?)\}/.exec(text);
  if (!match) return [];
  const keys = [...(match[1] ?? "").matchAll(/"([^"]+)"\s*:/g)].map((m) => (m[1] ?? "").replace(/\*.*$/, ""));
  return keys.filter((k) => k.length > 0);
}

export function chooseTsConfig(snapshot: Snapshot, requested: string | null): string | null {
  if (requested !== null) return snapshot.files.includes(requested) ? requested : null;
  for (const candidate of ["tsconfig.json", "jsconfig.json"])
    if (snapshot.files.includes(candidate)) return candidate;
  return null;
}

/** Build the module graph of a snapshot using dependency-cruiser's public API. Never executes repository code. */
export async function buildGraph(
  snapshot: Snapshot,
  options: { tsConfig: string | null; side: "base" | "head" },
  limitations: Limitations
): Promise<ModuleGraph> {
  const tsConfig = chooseTsConfig(snapshot, options.tsConfig);
  if (options.tsConfig !== null && tsConfig === null && options.side === "head") {
    limitations.add(
      "tsconfig-not-found",
      "The requested tsconfig was not found; path aliases were not resolved.",
      options.tsConfig
    );
  }
  const packages = findPackages(snapshot);
  const jsTsFiles = snapshot.files.filter(isJsTs);

  const empty: ModuleGraph = {
    modules: new Set(),
    deps: new Map(),
    rdeps: new Map(),
    unresolvedLocal: new Map(),
    external: new Map(),
    packages,
    tsConfig,
    stats: { modules: 0, edges: 0, unresolvedLocal: 0 },
  };
  if (jsTsFiles.length === 0) return empty;

  let transpileOptions: Record<string, unknown> = {};
  let usedTsConfig = tsConfig;
  if (tsConfig !== null) {
    try {
      transpileOptions = { tsConfig: extractTSConfig(`${snapshot.dir}/${tsConfig}`) };
    } catch {
      usedTsConfig = null;
      if (options.side === "head") {
        limitations.add(
          "tsconfig-unreadable",
          "The tsconfig could not be loaded (e.g. `extends` points to an uninstalled package); path aliases were not resolved.",
          tsConfig
        );
      }
    }
  }
  if (options.side === "head") {
    const nested = snapshot.files.filter(
      (p) =>
        p !== usedTsConfig &&
        /(^|\/)tsconfig[^/]*\.json$/.test(p) &&
        /"paths"\s*:/.test(snapshot.read(p) ?? "")
    );
    for (const p of nested) {
      limitations.add(
        "additional-tsconfig-paths-ignored",
        "Only one tsconfig is used for alias resolution; `paths` in these other tsconfig files were not applied.",
        p
      );
    }
  }

  const cruiseOptions: Record<string, unknown> = {
    baseDir: snapshot.dir,
    tsPreCompilationDeps: true,
    combinedDependencies: false,
    detectJSDocImports: false,
    exoticRequireStrings: [],
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)node_modules/" },
  };
  if (usedTsConfig !== null) cruiseOptions["tsConfig"] = { fileName: `${snapshot.dir}/${usedTsConfig}` };

  const result = await cruise(["."], cruiseOptions as never, {} as never, transpileOptions as never);
  const output = result.output as unknown as { modules: CruiseModule[] };

  const fileSet = new Set([...snapshot.files, ...snapshot.placeholders]);
  const aliasPrefixes = tsconfigAliasPrefixes(usedTsConfig ? snapshot.read(usedTsConfig) : null);
  const graph: ModuleGraph = { ...empty, tsConfig: usedTsConfig };
  const addEdge = (
    from: string,
    to: string,
    specifier: string,
    provenance: Edge["provenance"],
    typeOnly: boolean
  ): void => {
    graph.modules.add(to);
    let targets = graph.deps.get(from);
    if (!targets) graph.deps.set(from, (targets = new Map()));
    const existing = targets.get(to);
    if (existing) {
      if (!existing.specifiers.includes(specifier)) existing.specifiers.push(specifier);
      if (provenance === "graph") existing.provenance = "graph";
      existing.typeOnly = existing.typeOnly && typeOnly;
    } else {
      targets.set(to, { specifiers: [specifier], provenance, typeOnly });
    }
    let sources = graph.rdeps.get(to);
    if (!sources) graph.rdeps.set(to, (sources = new Set()));
    sources.add(from);
  };

  let inferredEdges = 0;
  for (const mod of output.modules) {
    if (mod.couldNotResolve || mod.coreModule || !fileSet.has(mod.source)) continue;
    graph.modules.add(mod.source);
    for (const dep of mod.dependencies) {
      if (dep.coreModule) {
        const list = graph.external.get(mod.source) ?? [];
        if (!list.includes(dep.module)) list.push(dep.module);
        graph.external.set(mod.source, list);
        continue;
      }
      const typeOnly = dep.dependencyTypes.includes("type-only");
      if (!dep.couldNotResolve && fileSet.has(dep.resolved)) {
        addEdge(mod.source, dep.resolved, dep.module, "graph", typeOnly);
        continue;
      }
      const ws = isRelative(dep.module)
        ? null
        : resolveWorkspaceSpecifier(dep.module, packages, (p) => fileSet.has(p));
      if (ws) {
        addEdge(mod.source, ws.target, dep.module, "inferred", typeOnly);
        inferredEdges++;
        continue;
      }
      const local =
        isRelative(dep.module) ||
        dep.module.startsWith("/") ||
        aliasPrefixes.some((p) => dep.module.startsWith(p));
      const bucket = local ? graph.unresolvedLocal : graph.external;
      const list = bucket.get(mod.source) ?? [];
      if (!list.includes(dep.module)) list.push(dep.module);
      bucket.set(mod.source, list);
    }
  }

  for (const list of graph.unresolvedLocal.values()) list.sort(compareStrings);
  for (const list of graph.external.values()) list.sort(compareStrings);
  for (const targets of graph.deps.values())
    for (const edge of targets.values()) edge.specifiers.sort(compareStrings);

  if (options.side === "head") {
    if (inferredEdges > 0) {
      limitations.addCount(
        "workspace-edges-inferred",
        "Imports of workspace packages were mapped to package source entries by convention (provenance: inferred), because no installed node_modules are used.",
        inferredEdges
      );
    }
    for (const [from, specs] of graph.unresolvedLocal) {
      for (const spec of specs) {
        limitations.add(
          "unresolved-local-import",
          "Local imports that could not be resolved; their dependents may be missing.",
          `${from} → ${spec}`
        );
      }
    }
    for (const path of jsTsFiles) {
      if (scanNonLiteralImports(snapshot.read(path) ?? "") > 0) {
        limitations.add(
          "non-literal-dynamic-import",
          "Dynamic import()/require() with a non-literal argument cannot be resolved statically; edges from these modules may be missing.",
          path
        );
      }
    }
  }

  let edges = 0;
  for (const targets of graph.deps.values()) edges += targets.size;
  let unresolved = 0;
  for (const list of graph.unresolvedLocal.values()) unresolved += list.length;
  graph.stats = { modules: graph.modules.size, edges, unresolvedLocal: unresolved };
  return graph;
}
