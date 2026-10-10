// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
/**
 * Reverse-dependency impact ("blast radius"): breadth-first search from every changed module with
 * shortest import chains, nearest-root distances, provenance propagation and depth/size limits.
 */
import type { AffectedModule, Provenance } from "../types.js";
import type { ModuleGraph } from "../graph/graph.js";
import { compareStrings } from "./limitations.js";

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

interface NodeState {
  distance: number;
  via: string[];
  provenance: Provenance;
  roots: Set<string>;
}

/** Direct dependents of a node (head graph plus extra base-graph edges), sorted, with edge provenance. */
function reverseNeighbors(input: ImpactInput, node: string): { path: string; provenance: Provenance }[] {
  const out = new Map<string, Provenance>();
  for (const dependent of input.graph.rdeps.get(node) ?? []) {
    const edge = input.graph.deps.get(dependent)?.get(node);
    out.set(dependent, edge?.provenance === "inferred" ? "inferred" : "graph");
  }
  for (const dependent of input.extraReverse.get(node) ?? [])
    if (!out.has(dependent)) out.set(dependent, "graph");
  return [...out.entries()]
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([path, provenance]) => ({ path, provenance }));
}

/** Reverse-dependency BFS from every changed root. Deterministic: roots and neighbors are visited in sorted order. */
export function computeImpact(input: ImpactInput): ImpactResult {
  const roots = [...new Set(input.roots)].sort(compareStrings);
  const rootSet = new Set(roots);
  const states = new Map<string, NodeState>();
  const dependentCounts = new Map<string, number>();
  let depthLimited = false;

  for (const root of roots) {
    const seen = new Map<string, { via: string[]; provenance: Provenance }>([
      [root, { via: [root], provenance: "observed" }],
    ]);
    let frontier = [root];
    for (let depth = 1; depth <= input.maxDepth && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const node of frontier) {
        const current = seen.get(node) as { via: string[]; provenance: Provenance };
        for (const neighbor of reverseNeighbors(input, node)) {
          if (seen.has(neighbor.path)) continue;
          const provenance: Provenance =
            current.provenance === "inferred" || neighbor.provenance === "inferred" ? "inferred" : "graph";
          seen.set(neighbor.path, { via: [...current.via, neighbor.path], provenance });
          next.push(neighbor.path);
          if (rootSet.has(neighbor.path)) continue;
          const state = states.get(neighbor.path);
          if (!state || depth < state.distance) {
            states.set(neighbor.path, {
              distance: depth,
              via: [...current.via, neighbor.path],
              provenance,
              roots: new Set([...(state?.roots ?? []), root]),
            });
          } else {
            state.roots.add(root);
          }
        }
      }
      frontier = next.sort(compareStrings);
    }
    if (!depthLimited) {
      depthLimited = frontier.some((node) => reverseNeighbors(input, node).some((n) => !seen.has(n.path)));
    }
    dependentCounts.set(root, seen.size - 1);
  }

  const changed: AffectedModule[] = roots.map((path) => ({
    path,
    reason: "changed",
    distance: 0,
    provenance: "observed",
    via: [path],
    changed_roots: [path],
    evidence: [],
  }));
  let dependents: AffectedModule[] = [...states.entries()].map(([path, state]) => ({
    path,
    reason: "dependent",
    distance: state.distance,
    provenance: state.provenance,
    via: state.via,
    changed_roots: [...state.roots].sort(compareStrings),
    evidence: [],
  }));
  dependents.sort((a, b) => a.distance - b.distance || compareStrings(a.path, b.path));
  const truncated = dependents.length > input.maxAffected;
  if (truncated) dependents = dependents.slice(0, input.maxAffected);
  return { affected: [...changed, ...dependents], truncated, dependentCounts, depthLimited };
}
