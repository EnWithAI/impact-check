import { compareStrings } from "./limitations.js";
/** Direct dependents of a node (head graph plus extra base-graph edges), sorted, with edge provenance. */
function reverseNeighbors(input, node) {
    const out = new Map();
    for (const dependent of input.graph.rdeps.get(node) ?? []) {
        const edge = input.graph.deps.get(dependent)?.get(node);
        out.set(dependent, edge?.provenance === "inferred" ? "inferred" : "graph");
    }
    for (const dependent of input.extraReverse.get(node) ?? [])
        if (!out.has(dependent))
            out.set(dependent, "graph");
    return [...out.entries()]
        .sort(([a], [b]) => compareStrings(a, b))
        .map(([path, provenance]) => ({ path, provenance }));
}
/** Reverse-dependency BFS from every changed root. Deterministic: roots and neighbors are visited in sorted order. */
export function computeImpact(input) {
    const roots = [...new Set(input.roots)].sort(compareStrings);
    const rootSet = new Set(roots);
    const states = new Map();
    const dependentCounts = new Map();
    let depthLimited = false;
    for (const root of roots) {
        const seen = new Map([
            [root, { via: [root], provenance: "observed" }],
        ]);
        let frontier = [root];
        for (let depth = 1; depth <= input.maxDepth && frontier.length > 0; depth++) {
            const next = [];
            for (const node of frontier) {
                const current = seen.get(node);
                for (const neighbor of reverseNeighbors(input, node)) {
                    if (seen.has(neighbor.path))
                        continue;
                    const provenance = current.provenance === "inferred" || neighbor.provenance === "inferred" ? "inferred" : "graph";
                    seen.set(neighbor.path, { via: [...current.via, neighbor.path], provenance });
                    next.push(neighbor.path);
                    if (rootSet.has(neighbor.path))
                        continue;
                    const state = states.get(neighbor.path);
                    if (!state || depth < state.distance) {
                        states.set(neighbor.path, {
                            distance: depth,
                            via: [...current.via, neighbor.path],
                            provenance,
                            roots: new Set([...(state?.roots ?? []), root]),
                        });
                    }
                    else {
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
    const changed = roots.map((path) => ({
        path,
        reason: "changed",
        distance: 0,
        provenance: "observed",
        via: [path],
        changed_roots: [path],
        evidence: [],
    }));
    let dependents = [...states.entries()].map(([path, state]) => ({
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
    if (truncated)
        dependents = dependents.slice(0, input.maxAffected);
    return { affected: [...changed, ...dependents], truncated, dependentCounts, depthLimited };
}
