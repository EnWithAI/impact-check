import { describe, expect, it } from "vitest";
import { analyzeJson, dependents, limitationCodes, Repo, ruleIds } from "./helpers.js";
import { basicTs } from "./fixtures/basic-ts.js";

describe("basic TS fixture — reverse dependencies (acceptance B, C)", () => {
  it("reports a changed utility and exactly its real reverse dependents", async () => {
    const repo = Repo.create(basicTs).branch("feature");
    repo.write({
      "src/utils/format.ts": basicTs["src/utils/format.ts"]!.replace("toFixed(2)", "toFixed(3)"),
    });
    repo.commit("tweak format");

    const report = await analyzeJson(repo.dir, ["--base", "main", "--head", "HEAD"]);
    expect(report.filesChanged.map((f) => [f.path, f.status])).toEqual([["src/utils/format.ts", "modified"]]);
    expect(report.filesChanged[0]!.changedLines).toEqual([{ start: 2, end: 2 }]);
    expect(dependents(report).sort()).toEqual(
      [
        "src/index.ts",
        "src/services/cart.ts",
        "src/services/checkout.ts",
        "src/utils/format.test.ts",
        "test/cart.test.ts",
      ].sort()
    );
    const cart = report.affectedModules.find((m) => m.path === "src/services/cart.ts")!;
    expect(cart).toMatchObject({
      distance: 1,
      provenance: "graph",
      via: ["src/utils/format.ts", "src/services/cart.ts"],
    });
    const index = report.affectedModules.find((m) => m.path === "src/index.ts")!;
    expect(index.distance).toBe(3);
    expect(index.via).toEqual([
      "src/utils/format.ts",
      "src/services/cart.ts",
      "src/services/checkout.ts",
      "src/index.ts",
    ]);
    // No invented edges: unrelated modules never appear.
    for (const unrelated of [
      "src/utils/unused.ts",
      "src/auth/session.ts",
      "src/plugins/loader.ts",
      "src/legacy/missing.ts",
    ]) {
      expect(report.affectedModules.map((m) => m.path)).not.toContain(unrelated);
    }
    // Suggested tests are graph-derived plus naming convention, never claimed as run.
    const tests = Object.fromEntries(report.suggestedTests.map((t) => [t.path, t]));
    expect(tests["src/utils/format.test.ts"]!.reasons).toEqual([
      "imports-affected-module",
      "naming-convention",
    ]);
    expect(tests["test/cart.test.ts"]!.reasons).toEqual(["imports-affected-module"]);
    expect(report.suggestedTests.every((t) => t.status === "not-run")).toBe(true);
    expect(limitationCodes(report)).toEqual(
      expect.arrayContaining(["tests-not-executed", "semantic-analysis-not-performed"])
    );
  });

  it("a changed module with no dependents yields no affected modules beyond itself", async () => {
    const repo = Repo.create(basicTs).branch("feature");
    repo.write({ "src/utils/unused.ts": "export const unused = 43;\n" });
    repo.commit("bump");
    const report = await analyzeJson(repo.dir, ["--base", "main", "--head", "HEAD"]);
    expect(report.affectedModules).toEqual([
      {
        path: "src/utils/unused.ts",
        reason: "changed",
        distance: 0,
        provenance: "observed",
        via: ["src/utils/unused.ts"],
        changedRoots: ["src/utils/unused.ts"],
      },
    ]);
    expect(ruleIds(report)).not.toContain("wide-blast-radius");
  });

  it("an unrelated (non-code) change yields no fabricated modules or findings", async () => {
    const repo = Repo.create(basicTs).branch("docs");
    repo.write({ "README.md": "# Basic fixture\n\nMore docs.\n" });
    repo.commit("docs");
    const report = await analyzeJson(repo.dir, ["--base", "main", "--head", "HEAD"]);
    expect(report.filesChanged.map((f) => f.kind)).toEqual(["other"]);
    expect(report.affectedModules).toEqual([]);
    expect(report.riskFindings).toEqual([]);
    expect(report.suggestedTests).toEqual([]);
  });

  it("reports dynamic imports and unresolved local imports as limitations", async () => {
    const repo = Repo.create(basicTs).branch("feature");
    repo.write({ "src/plugins/loader.ts": basicTs["src/plugins/loader.ts"] + "// touched\n" });
    repo.commit("touch");
    const report = await analyzeJson(repo.dir, ["--base", "main", "--head", "HEAD"]);
    const byCode = Object.fromEntries(report.coverageLimitations.map((l) => [l.code, l]));
    expect(byCode["non-literal-dynamic-import"]!.paths).toEqual(["src/plugins/loader.ts"]);
    expect(byCode["unresolved-local-import"]!.paths).toEqual(["src/legacy/missing.ts → ./does-not-exist"]);
    expect(report.analysis.headGraph.unresolvedLocal).toBe(1);
  });

  it("resolves tsconfig path aliases as graph edges", async () => {
    const repo = Repo.create(basicTs).branch("feature");
    repo.write({ "src/utils/format.ts": basicTs["src/utils/format.ts"] + "export const X = 1;\n" });
    repo.commit("add export");
    const report = await analyzeJson(repo.dir, ["--base", "main", "--head", "HEAD"]);
    expect(report.repository.tsConfig).toBe("tsconfig.json");
    expect(report.affectedModules.find((m) => m.path === "src/services/cart.ts")?.provenance).toBe("graph");
  });
});
