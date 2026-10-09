import { describe, expect, it } from "vitest";
import {
  parseNameStatus,
  parseNumstat,
  parseUnifiedZero,
  unquoteGitPath,
  validateRef,
} from "../src/git/repo.js";
import { exportDescriptor, findSpecifierLine, scanNonLiteralImports } from "../src/graph/lexical.js";
import { computeImpact } from "../src/analysis/impact.js";
import { Limitations } from "../src/analysis/limitations.js";
import type { ModuleGraph } from "../src/graph/graph.js";
import { isSafeRelativePath, kindOf, languageOf } from "../src/util/classify.js";
import { evaluatePolicy } from "../src/policy.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { resolveWorkspaceSpecifier } from "../src/graph/workspaces.js";

const z = (...parts: string[]): Buffer => Buffer.from(parts.join("\0") + "\0");

describe("git output parsers", () => {
  it("parses name-status with renames, copies, type changes and unmerged", () => {
    expect(
      parseNameStatus(
        z(
          "M",
          "a.ts",
          "R087",
          "old.ts",
          "new.ts",
          "A",
          "b c.ts",
          "D",
          "d.ts",
          "T",
          "e",
          "U",
          "f",
          "C100",
          "g",
          "h"
        )
      )
    ).toEqual([
      { path: "a.ts", previousPath: null, status: "modified" },
      { path: "new.ts", previousPath: "old.ts", status: "renamed" },
      { path: "b c.ts", previousPath: null, status: "added" },
      { path: "d.ts", previousPath: null, status: "deleted" },
      { path: "e", previousPath: null, status: "type-changed" },
      { path: "f", previousPath: null, status: "unmerged" },
      { path: "h", previousPath: null, status: "added" },
    ]);
  });
  it("parses numstat including binary and renames", () => {
    const map = parseNumstat(z("3\t1\ta.ts", "-\t-\tlogo.png", "2\t2\t", "old.ts", "new.ts"));
    expect(map.get("a.ts")).toEqual({ additions: 3, deletions: 1, binary: false });
    expect(map.get("logo.png")).toEqual({ additions: null, deletions: null, binary: true });
    expect(map.get("new.ts")).toEqual({ additions: 2, deletions: 2, binary: false });
  });
  it("unquotes C-style git paths", () => {
    expect(unquoteGitPath('"a\\tb\\n\\"c\\\\"')).toBe('a\tb\n"c\\');
    expect(unquoteGitPath('"\\303\\251"')).toBe("é");
    expect(unquoteGitPath("plain")).toBe("plain");
  });
  it("parses -U0 hunks with head-side ranges and line text", () => {
    const text = [
      "diff --git a/x.ts b/x.ts",
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -2 +2,2 @@",
      "-export const a = 1;",
      "+export const a = 2;",
      "+--- not a header",
      "@@ -10,0 +11 @@",
      "+x",
      "diff --git a/gone.ts b/gone.ts",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
      'diff --git "a/q\\"x.ts" "b/q\\"x.ts"',
      '--- "a/q\\"x.ts"',
      '+++ "b/q\\"x.ts"',
      "@@ -1 +1 @@",
      "-1",
      "+2",
      "\\ No newline at end of file",
    ].join("\n");
    const hunks = parseUnifiedZero(text);
    expect(hunks.get("x.ts")!.ranges).toEqual([
      { start: 2, end: 3 },
      { start: 11, end: 11 },
    ]);
    expect(hunks.get("x.ts")!.removed).toEqual([{ line: 2, text: "export const a = 1;" }]);
    expect(hunks.get("x.ts")!.added.map((l) => l.line)).toEqual([2, 3, 11]);
    expect(hunks.get("gone.ts")!.ranges).toEqual([]);
    expect(hunks.get('q"x.ts')!.added).toEqual([{ line: 1, text: "2" }]);
  });
  it("validates refs", () => {
    expect(validateRef("feature/x", "--base")).toBe("feature/x");
    for (const bad of ["", "-x", "a\nb", "x".repeat(300)]) expect(() => validateRef(bad, "--base")).toThrow();
  });
});

describe("lexical helpers", () => {
  it("detects non-literal dynamic imports only", () => {
    expect(scanNonLiteralImports('import("./a"); require("b"); import(`./c`);')).toBe(0);
    expect(scanNonLiteralImports("import(name); require(path); import(`./${x}`);")).toBe(3);
    expect(scanNonLiteralImports("// import(name)\n/* require(x) */ obj.require(y)")).toBe(0);
  });
  it("describes export lines by name only", () => {
    expect(exportDescriptor('export const KEY = "secret";')).toBe("const KEY");
    expect(exportDescriptor("export default async function* gen() {}")).toBe("function gen");
    expect(exportDescriptor("export { a, b as c, type D };")).toBe("{ a, c, D }");
    expect(exportDescriptor('export * from "./x";')).toBe("* (re-export)");
    expect(exportDescriptor('export * as ns from "./x";')).toBe("* as ns");
    expect(exportDescriptor("export default {};")).toBe("default");
    expect(exportDescriptor("module.exports = {};")).toBe("module.exports");
    expect(exportDescriptor("module.exports.run = f;")).toBe("module.exports.run");
    expect(exportDescriptor("exports.x = 1;")).toBe("exports.x");
    expect(exportDescriptor("const x = 1;")).toBeNull();
  });
  it("finds the line of an import specifier", () => {
    expect(findSpecifierLine("a\nimport x from './y';\n", "./y")).toBe(2);
    expect(findSpecifierLine("nothing", "./y")).toBeNull();
  });
});

function graph(edges: [string, string, ("graph" | "inferred")?][]): ModuleGraph {
  const g: ModuleGraph = {
    modules: new Set(),
    deps: new Map(),
    rdeps: new Map(),
    unresolvedLocal: new Map(),
    external: new Map(),
    packages: [],
    tsConfig: null,
    stats: { modules: 0, edges: 0, unresolvedLocal: 0 },
  };
  for (const [from, to, provenance] of edges) {
    g.modules.add(from).add(to);
    if (!g.deps.has(from)) g.deps.set(from, new Map());
    g.deps.get(from)!.set(to, { specifiers: [to], provenance: provenance ?? "graph", typeOnly: false });
    if (!g.rdeps.has(to)) g.rdeps.set(to, new Set());
    g.rdeps.get(to)!.add(from);
  }
  return g;
}

describe("impact BFS", () => {
  const g = graph([
    ["b", "a"],
    ["c", "b"],
    ["d", "c"],
    ["e", "a", "inferred"],
    ["f", "e"],
    ["a", "f"],
  ]);
  it("computes shortest paths, provenance and handles cycles", () => {
    const r = computeImpact({
      graph: g,
      roots: ["a"],
      extraReverse: new Map(),
      maxDepth: 10,
      maxAffected: 100,
    });
    expect(r.affected.map((m) => [m.path, m.distance, m.provenance])).toEqual([
      ["a", 0, "observed"],
      ["b", 1, "graph"],
      ["e", 1, "inferred"],
      ["c", 2, "graph"],
      ["f", 2, "inferred"],
      ["d", 3, "graph"],
    ]);
    expect(r.dependentCounts.get("a")).toBe(5);
  });
  it("respects depth and size limits", () => {
    const r = computeImpact({ graph: g, roots: ["a"], extraReverse: new Map(), maxDepth: 1, maxAffected: 1 });
    expect(r.affected.map((m) => m.path)).toEqual(["a", "b"]);
    expect(r.truncated).toBe(true);
  });
  it("merges roots and picks the nearest", () => {
    const r = computeImpact({
      graph: g,
      roots: ["c", "a"],
      extraReverse: new Map([["z", ["d"]]]),
      maxDepth: 10,
      maxAffected: 100,
    });
    const d = r.affected.find((m) => m.path === "d")!;
    expect(d).toMatchObject({ distance: 1, via: ["c", "d"], changedRoots: ["a", "c"] });
    expect(r.affected.find((m) => m.path === "c")!.reason).toBe("changed");
  });
});

describe("misc units", () => {
  it("limitations are sorted and de-duplicated", () => {
    const l = new Limitations();
    l.add("b", "B", "y");
    l.add("b", "B", "x");
    l.add("b", "B", "x");
    l.add("a", "A");
    l.addCount("c", "C", 7);
    expect(l.toArray()).toEqual([
      { code: "a", message: "A", paths: [], count: 1 },
      { code: "b", message: "B", paths: ["x", "y"], count: 2 },
      { code: "c", message: "C", paths: [], count: 7 },
    ]);
  });
  it("classifies files", () => {
    expect(kindOf("src/a.test.ts")).toBe("test");
    expect(kindOf("__tests__/a.js")).toBe("test");
    expect(kindOf("tsconfig.base.json")).toBe("config");
    expect(kindOf(".github/workflows/x.yml")).toBe("config");
    expect(kindOf("src/a.mts")).toBe("source");
    expect(languageOf("a.cjs")).toBe("javascript");
    expect(languageOf("a.py")).toBe("other");
    expect(isSafeRelativePath("../x")).toBe(false);
    expect(isSafeRelativePath("/abs")).toBe(false);
    expect(isSafeRelativePath("a//b")).toBe(false);
    expect(isSafeRelativePath("a/b c.ts")).toBe(true);
  });
  it("evaluates policies", () => {
    const report = {
      riskFindings: [{ id: "x:00000000", ruleId: "x", severity: "medium" }],
      summary: { affectedModules: 3 },
    } as never;
    expect(evaluatePolicy(report, DEFAULT_CONFIG.policy).passed).toBe(true);
    expect(
      evaluatePolicy(report, { ...DEFAULT_CONFIG.policy, failOnSeverity: "medium" }).violations
    ).toHaveLength(1);
  });
  it("resolves workspace subpaths", () => {
    const pkgs = [{ name: "@a/b", dir: "packages/b", manifest: {} }];
    const files = new Set(["packages/b/src/util/index.ts", "packages/b/index.js"]);
    expect(resolveWorkspaceSpecifier("@a/b/util", pkgs, (p) => files.has(p))?.target).toBe(
      "packages/b/src/util/index.ts"
    );
    expect(resolveWorkspaceSpecifier("@a/b", pkgs, (p) => files.has(p))?.target).toBe("packages/b/index.js");
    expect(resolveWorkspaceSpecifier("@a/bc", pkgs, (p) => files.has(p))).toBeNull();
  });
});
