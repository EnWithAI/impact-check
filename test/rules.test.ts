// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
/**
 * Rule behavior: verified facts vs hypotheses for exports and broken imports, path-convention rules,
 * manifest changes, test-change rules, package entries, blast radius and workspace (monorepo) inference.
 */
import { describe, expect, it } from "vitest";
import { analyzeJson, dependents, limitationCodes, Repo, ruleIds } from "./helpers.js";
import { basicTs } from "./fixtures/basic-ts.js";
import { monorepo } from "./fixtures/monorepo.js";

const head = ["--base", "main", "--head", "HEAD"];

describe("risk rules (acceptance D)", () => {
  it("export change is a heuristic candidate; a broken import of a deleted module is a confirmed graph fact", async () => {
    const repo = Repo.create(basicTs).branch("feature");
    repo.write({
      "src/services/cart.ts": basicTs["src/services/cart.ts"]!.replace(
        "export function total(items: Item[])",
        "export function total(items: Item[], tax = 0)"
      ),
    });
    repo.remove("src/utils/format.ts");
    repo.commit("break things");
    const report = await analyzeJson(repo.dir, head);

    const exportFinding = report.findings.find(
      (f) => f.rule_id === "export-surface-changed" && f.summary.includes("cart.ts")
    )!;
    expect(exportFinding).toMatchObject({
      category: "public-api",
      is_heuristic: true,
      provenance: "inferred",
      severity: "medium",
    });
    expect(exportFinding.summary).toMatch(/^Potential/);
    // Parser-based (schema 2.0): the changed line lies in the signature of `total`; reported once, head side.
    expect(exportFinding.status).toBe("hypothesis");
    expect(exportFinding.evidence).toEqual([
      expect.objectContaining({
        kind: "export-declaration",
        side: "head",
        line_start: 7,
        detail: "signature lines changed: function total",
      }),
    ]);

    const broken = report.findings.find((f) => f.rule_id === "broken-import")!;
    expect(broken).toMatchObject({
      category: "broken-import",
      is_heuristic: false,
      provenance: "graph",
      severity: "high",
      confidence: "high",
    });
    const brokenPaths = broken.evidence
      .filter((e) => e.kind === "import-edge")
      .map((e) => [e.path, e.line_start]);
    expect(brokenPaths).toEqual([
      ["src/services/cart.ts", 1],
      ["src/utils/format.test.ts", 1],
    ]);
    expect(report.findings[0]!.rule_id).toBe("broken-import"); // sorted by severity first
    const deleted = report.findings.find((f) => f.rule_id === "deleted-module-with-dependents")!;
    expect(deleted.severity).toBe("medium"); // format.test.ts was not modified
    // Base dependents of the deleted module are listed as affected (graph provenance via base graph).
    expect(dependents(report)).toContain("src/utils/format.test.ts");
    expect(report.affected_modules.find((m) => m.path === "src/utils/format.test.ts")?.via).toEqual([
      "src/utils/format.ts",
      "src/utils/format.test.ts",
    ]);
    expect(report.affected_modules.find((m) => m.path === "src/services/cart.ts")?.reason).toBe("changed");
  });

  it("flags migrations, API contracts, config, security paths and imports as heuristics", async () => {
    const repo = Repo.create(basicTs).branch("feature");
    repo.write({
      "db/migrations/002_add_price.sql": "ALTER TABLE items ADD price INT;\n",
      "api/openapi.yaml": "openapi: 3.1.0\n",
      "schema.graphql": "type Query { a: Int }\n",
      ".github/workflows/ci.yml": "name: ci\n",
      ".env.example": "API_KEY=\n",
      "vite.config.ts": "export default {};\n",
      "src/auth/session.ts": basicTs["src/auth/session.ts"] + "// change\n",
      "src/permissions/roles.ts": "export const roles = [];\n",
    });
    repo.commit("misc");
    const report = await analyzeJson(repo.dir, head);
    const ids = ruleIds(report);
    for (const id of [
      "migration-changed",
      "api-contract-changed",
      "config-changed",
      "security-sensitive-change",
    ])
      expect(ids).toContain(id);
    for (const f of report.findings) {
      expect(f.is_heuristic).toBe(f.status !== "verified_static_fact");
      // Path-convention rules are never presented as facts.
      if (
        ["migration-changed", "api-contract-changed", "config-changed", "security-sensitive-change"].includes(
          f.rule_id
        )
      )
        expect(f.status).toBe("hypothesis");
    }
    const migration = report.findings.find((f) => f.rule_id === "migration-changed")!;
    expect(migration.evidence.map((e) => e.path)).toEqual(["db/migrations/002_add_price.sql"]);
    const contract = report.findings.find((f) => f.rule_id === "api-contract-changed")!;
    expect(contract.evidence.map((e) => e.path).sort()).toEqual(["api/openapi.yaml", "schema.graphql"]);
    const configs = report.findings.filter((f) => f.rule_id === "config-changed");
    expect(configs.map((f) => f.severity)).toEqual(["medium", "low"]);
    expect(configs[0]!.evidence.map((e) => e.path).sort()).toEqual([
      ".env.example",
      ".github/workflows/ci.yml",
    ]);
    const session = report.findings.find(
      (f) => f.rule_id === "security-sensitive-change" && f.affected_modules.includes("src/auth/session.ts")
    )!;
    expect(session.provenance).toBe("graph");
    expect(session.evidence.map((e) => e.detail)).toEqual([
      "security-related path name",
      'imports "jsonwebtoken"',
    ]);
    expect(session.evidence[1]!.line_start).toBe(1);
    expect(report.findings.some((f) => f.affected_modules.includes("src/permissions/roles.ts"))).toBe(true);
  });

  it("reports package manifest field changes by name only and never runs scripts", async () => {
    const repo = Repo.create(basicTs).branch("feature");
    const pkg = JSON.parse(basicTs["package.json"]!);
    pkg.main = "src/main.ts";
    pkg.scripts.postinstall = "node -e \"require('fs').writeFileSync('PWNED','x')\"";
    pkg.dependencies = { "left-pad": "1.3.0" };
    repo.write({ "package.json": JSON.stringify(pkg, null, 2) });
    repo.commit("manifest");
    const report = await analyzeJson(repo.dir, head);
    const finding = report.findings.find((f) => f.rule_id === "package-manifest-changed")!;
    expect(finding.severity).toBe("medium");
    expect(finding.evidence.map((e) => e.detail)).toEqual([
      'field "dependencies" added: left-pad',
      'field "main" changed',
      'field "scripts" changed (scripts are never executed by Impact Check)',
    ]);
    expect(JSON.stringify(report)).not.toContain("writeFileSync");
  });

  it("flags deleted tests and source changes without tests", async () => {
    const repo = Repo.create(basicTs).branch("feature");
    repo.remove("test/cart.test.ts");
    repo.commit("drop test");
    const report = await analyzeJson(repo.dir, head);
    expect(report.findings.find((f) => f.rule_id === "tests-removed")).toMatchObject({
      severity: "medium",
      provenance: "observed",
    });

    const repo2 = Repo.create(basicTs).branch("feature");
    repo2.write({ "src/utils/unused.ts": "export const unused = 7;\n" });
    repo2.commit("src only");
    const report2 = await analyzeJson(repo2.dir, head);
    expect(report2.findings.find((f) => f.rule_id === "source-without-test-change")?.severity).toBe("info");
  });

  it("flags package entry points and wide blast radius", async () => {
    const files: Record<string, string> = { ...basicTs, "src/core.ts": "export const core = 1;\n" };
    for (let i = 0; i < 12; i++)
      files[`src/consumers/c${i}.ts`] = 'import { core } from "../core";\nexport const v = core;\n';
    const repo = Repo.create(files).branch("feature");
    repo.write({
      "src/core.ts": "export const core = 2;\n",
      "src/index.ts": 'export * from "./services/checkout";\nexport const extra = 1;\n',
    });
    repo.commit("core");
    const report = await analyzeJson(repo.dir, head);
    const wide = report.findings.find((f) => f.rule_id === "wide-blast-radius")!;
    expect(wide).toMatchObject({
      severity: "info",
      provenance: "graph",
      status: "verified_static_fact",
      is_heuristic: false,
    });
    expect(wide.summary).toBe("12 modules transitively depend on src/core.ts");
    const entry = report.findings.find((f) => f.rule_id === "package-entry-changed")!;
    expect(entry).toMatchObject({ confidence: "medium", affected_modules: ["src/index.ts"] });
  });
});

describe("monorepo / workspaces", () => {
  it("maps cross-package imports to source entries with inferred provenance", async () => {
    const repo = Repo.create(monorepo).branch("feature");
    repo.write({
      "packages/core/src/math.ts":
        "export function sum(a: number, b: number): number {\n  return b + a;\n}\n",
    });
    repo.commit("core change");
    const report = await analyzeJson(repo.dir, head);
    expect(report.repository.workspace_packages).toEqual([
      { name: "acme-monorepo", path: "." },
      { name: "@acme/app", path: "packages/app" },
      { name: "@acme/core", path: "packages/core" },
    ]);
    const byPath = Object.fromEntries(report.affected_modules.map((m) => [m.path, m]));
    expect(byPath["packages/core/src/index.ts"]).toMatchObject({ distance: 1, provenance: "graph" });
    expect(byPath["packages/app/src/main.ts"]).toMatchObject({ distance: 2, provenance: "inferred" });
    expect(byPath["packages/app/src/main.test.ts"]).toMatchObject({ distance: 3, provenance: "inferred" });
    expect(limitationCodes(report)).toContain("workspace-edges-inferred");
    expect(report.test_candidates.map((t) => t.path)).toEqual([
      "packages/app/src/main.test.ts",
      "packages/core/src/math.test.ts",
    ]);
  });
});
