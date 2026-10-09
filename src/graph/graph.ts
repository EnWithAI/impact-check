/**
 * Module graph construction on top of dependency-cruiser's public API. Produces dependencies, reverse
 * dependencies, unresolved local imports and external imports for a snapshot, and records graph-related coverage
 * limitations (tsconfig problems, workspace inference, dynamic loading, parse gaps).
 */
import { cruise } from "dependency-cruiser";
import extractTSConfig from "dependency-cruiser/config-utl/extract-ts-config";
import { writeFileSync } from "node:fs";
import ts from "typescript";
import type { Limitations } from "../analysis/limitations.js";
import { compareStrings } from "../analysis/limitations.js";
import type { Snapshot } from "../snapshot/snapshot.js";
import type { GraphStats } from "../types.js";
import { isJsTs } from "../util/classify.js";
import {
  findPackages,
  parseJsonObject,
  resolveWorkspaceSpecifier,
  type WorkspacePackage,
} from "./workspaces.js";
import { hasDynamicLoading, literalSpecifiers, scanNonLiteralImports } from "./lexical.js";

/** A dependency edge: the import specifiers used, how it was established, and whether it is type-only. */
export interface Edge {
  specifiers: string[];
  provenance: "graph" | "inferred";
  typeOnly: boolean;
}

/** Dependency graph of one snapshot (base or head). */
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

/** True for relative import specifiers (`./x`, `../x`, `.`, `..`). */
function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../") || specifier === "." || specifier === "..";
}

/** Prefixes of tsconfig `paths` aliases (e.g. `@utils/`), used to classify unresolved imports as local. */
function tsconfigAliasPrefixes(text: string | null): string[] {
  if (!text) return [];
  // tsconfig is JSONC; extract "paths" keys conservatively without evaluating anything.
  const match = /"paths"\s*:\s*\{([\s\S]*?)\}/.exec(text);
  if (!match) return [];
  const keys = [...(match[1] ?? "").matchAll(/"([^"]+)"\s*:/g)].map((m) => (m[1] ?? "").replace(/\*.*$/, ""));
  return keys.filter((k) => k.length > 0);
}

/**
 * Load a tsconfig via dependency-cruiser's helper. If that fails because `extends` references packages that are
 * not present (no node_modules in snapshots), retry with those non-relative `extends` entries removed. The config
 * text is parsed as data by TypeScript's JSONC parser; nothing is evaluated.
 */
function loadTsConfig(
  snapshot: Snapshot,
  tsConfig: string
): { parsed: unknown; file: string; droppedExtends: string[] } | null {
  const file = `${snapshot.dir}/${tsConfig}`;
  try {
    return { parsed: extractTSConfig(file), file, droppedExtends: [] };
  } catch {
    // fall through to the sanitized retry
  }
  const text = snapshot.read(tsConfig);
  if (text === null) return null;
  const { config } = ts.parseConfigFileTextToJson(tsConfig, text) as { config?: Record<string, unknown> };
  if (!config || typeof config !== "object") return null;
  const extendsValue = config["extends"];
  const list =
    typeof extendsValue === "string" ? [extendsValue] : Array.isArray(extendsValue) ? extendsValue : [];
  const isLocal = (v: unknown): v is string =>
    typeof v === "string" && (v.startsWith("./") || v.startsWith("../"));
  const kept = list.filter(isLocal);
  const dropped = list.filter((v): v is string => typeof v === "string" && !isLocal(v));
  if (dropped.length === 0) return null;
  const sanitized = { ...config, ...(kept.length > 0 ? { extends: kept } : {}) };
  if (kept.length === 0) delete sanitized["extends"];
  const dir = tsConfig.includes("/") ? tsConfig.slice(0, tsConfig.lastIndexOf("/") + 1) : "";
  const fallback = `${snapshot.dir}/${dir}.impact-check-tsconfig.json`;
  try {
    writeFileSync(fallback, JSON.stringify(sanitized), { mode: 0o600, flag: "wx" });
    return {
      parsed: extractTSConfig(fallback),
      file: fallback,
      droppedExtends: dropped.sort(compareStrings),
    };
  } catch {
    return null;
  }
}

/** Selects the tsconfig used for path aliases: the requested one, else tsconfig.json, else jsconfig.json. */
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
  // A malformed package.json makes enhanced-resolve fail for every import below it. Neutralize such manifests in
  // the private snapshot (never in the repository) and say so.
  for (const path of snapshot.files) {
    if (path !== "package.json" && !path.endsWith("/package.json")) continue;
    if (parseJsonObject(snapshot.read(path)) !== null) continue;
    writeFileSync(`${snapshot.dir}/${path}`, "{}", { mode: 0o600 });
    if (options.side === "head") {
      limitations.add(
        "package-json-unparseable",
        "These package.json files are not valid JSON objects; they were treated as empty for resolution, so package entry points and workspace names from them are unknown.",
        path
      );
    }
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
    stats: { modules: 0, edges: 0, unresolved_local: 0 },
  };
  if (jsTsFiles.length === 0) return empty;

  let transpileOptions: Record<string, unknown> = {};
  let usedTsConfig = tsConfig;
  let tsConfigFile: string | null = tsConfig === null ? null : `${snapshot.dir}/${tsConfig}`;
  if (tsConfig !== null && tsConfigFile !== null) {
    const loaded = loadTsConfig(snapshot, tsConfig);
    if (loaded) {
      transpileOptions = { tsConfig: loaded.parsed };
      tsConfigFile = loaded.file;
      if (loaded.droppedExtends.length > 0 && options.side === "head") {
        limitations.add(
          "tsconfig-extends-unavailable",
          "The tsconfig extends packages that are not available offline; they were ignored and only local settings (incl. paths) were applied.",
          `${tsConfig} → ${loaded.droppedExtends.join(", ")}`
        );
      }
    } else {
      usedTsConfig = null;
      tsConfigFile = null;
      if (options.side === "head") {
        limitations.add(
          "tsconfig-unreadable",
          "The tsconfig could not be loaded; path aliases were not resolved.",
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
  if (tsConfigFile !== null) cruiseOptions["tsConfig"] = { fileName: tsConfigFile };

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
      // Cross-check: literal specifiers seen lexically but absent from the parser's output suggest a parse failure.
      const seen = new Set([
        ...[...(graph.deps.get(path)?.values() ?? [])].flatMap((e) => e.specifiers),
        ...(graph.unresolvedLocal.get(path) ?? []),
        ...(graph.external.get(path) ?? []),
      ]);
      const text = snapshot.read(path) ?? "";
      const missing = literalSpecifiers(text).filter(
        (spec) => !seen.has(spec) && !seen.has(spec.replace(/^node:/, ""))
      );
      if (missing.length > 0 && seen.size === 0) {
        limitations.add(
          "imports-not-extracted",
          "The parser extracted no imports from these modules although import statements are present (likely a syntax error); their dependencies are missing from the graph.",
          path
        );
      }
      if (hasDynamicLoading(text)) {
        limitations.add(
          "dynamic-module-loading",
          "require.context, import.meta.glob, eval or new Function load code the resolver cannot see; dependencies of these modules may be missing.",
          path
        );
      }
      if (scanNonLiteralImports(text) > 0) {
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
  graph.stats = { modules: graph.modules.size, edges, unresolved_local: unresolved };
  return graph;
}
