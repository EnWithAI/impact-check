import type { Limitations } from "../analysis/limitations.js";
import type { Snapshot } from "../snapshot/snapshot.js";
import type { GraphStats } from "../types.js";
import { type WorkspacePackage } from "./workspaces.js";
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
/** Selects the tsconfig used for path aliases: the requested one, else tsconfig.json, else jsconfig.json. */
export declare function chooseTsConfig(snapshot: Snapshot, requested: string | null): string | null;
/** Build the module graph of a snapshot using dependency-cruiser's public API. Never executes repository code. */
export declare function buildGraph(snapshot: Snapshot, options: {
    tsConfig: string | null;
    side: "base" | "head";
}, limitations: Limitations): Promise<ModuleGraph>;
