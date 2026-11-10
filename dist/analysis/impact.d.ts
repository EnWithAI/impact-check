/**
 * Reverse-dependency impact ("blast radius"): breadth-first search from every changed module with
 * shortest import chains, nearest-root distances, provenance propagation and depth/size limits.
 */
import type { AffectedModule } from "../types.js";
import type { ModuleGraph } from "../graph/graph.js";
/** Input for computeImpact(). */
export interface ImpactInput {
    graph: ModuleGraph;
    /** Changed module paths present in the head graph (or deleted paths with extra seed dependents). */
    roots: string[];
    /** Additional reverse edges (e.g. base-graph dependents of deleted modules), root → dependents. */
    extraReverse: Map<string, string[]>;
    maxDepth: number;
    maxAffected: number;
}
/** Result of computeImpact(): changed roots first, then dependents sorted by distance and path. */
export interface ImpactResult {
    affected: AffectedModule[];
    truncated: boolean;
    /** Transitive dependents per changed root (within maxDepth). */
    dependentCounts: Map<string, number>;
    /** True when some dependents lie beyond maxDepth. */
    depthLimited: boolean;
}
/** Reverse-dependency BFS from every changed root. Deterministic: roots and neighbors are visited in sorted order. */
export declare function computeImpact(input: ImpactInput): ImpactResult;
