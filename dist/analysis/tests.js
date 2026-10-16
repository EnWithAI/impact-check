import { basenameOf, isTestPath } from "../util/classify.js";
import { compareStrings } from "./limitations.js";
const MAX_SUGGESTED = 1000;
/** File name without extension and test suffix (`cart.test.ts` → `cart`). */
function stem(path) {
    return basenameOf(path)
        .replace(/\.[cm]?[jt]sx?$/i, "")
        .replace(/\.(test|spec|e2e|it)$/i, "");
}
/**
 * Candidate tests to run. Sources: changed tests (observed), tests that transitively import a changed module
 * (graph), and tests whose file stem matches a changed source module (inferred). Nothing is executed.
 */
export function suggestTests(files, affected, headFiles, isTest = isTestPath) {
    const byPath = new Map();
    const add = (path, reason, related, provenance) => {
        let entry = byPath.get(path);
        if (!entry)
            byPath.set(path, (entry = { reasons: new Set(), related: new Set(), provenance: new Set() }));
        entry.reasons.add(reason);
        for (const r of related)
            entry.related.add(r);
        entry.provenance.add(provenance);
    };
    const headSet = new Set(headFiles);
    for (const file of files) {
        if (file.kind === "test" && file.status !== "deleted" && headSet.has(file.path))
            add(file.path, "changed-test", [], "observed");
    }
    for (const mod of affected) {
        if (mod.reason === "dependent" && isTest(mod.path))
            add(mod.path, "imports-affected-module", mod.changed_roots, mod.provenance);
    }
    const testsByStem = new Map();
    for (const path of headFiles) {
        if (!isTest(path))
            continue;
        const s = stem(path);
        testsByStem.set(s, [...(testsByStem.get(s) ?? []), path]);
    }
    for (const file of files) {
        if (file.kind !== "source" || file.status === "deleted")
            continue;
        const s = stem(file.path);
        if (s === "index" || s.length < 2)
            continue;
        for (const test of testsByStem.get(s) ?? [])
            add(test, "naming-convention", [file.path], "inferred");
    }
    const rank = (p) => p.has("observed") ? "observed" : p.has("graph") ? "graph" : "inferred";
    return [...byPath.entries()]
        .sort(([a], [b]) => compareStrings(a, b))
        .slice(0, MAX_SUGGESTED)
        .map(([path, entry]) => ({
        path,
        reasons: [...entry.reasons].sort(compareStrings),
        related_to: [...entry.related].sort(compareStrings),
        provenance: rank(entry.provenance),
        execution_status: "not_run",
    }));
}
