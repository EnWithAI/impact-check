// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
/**
 * Contract-diff acceptance fixtures I-C1 to I-C10 (docs/CONTRACT_DIFF.md). Each fixture directory holds a hand-written
 * base and head tree and `expected.json`, whose pointers and line numbers were computed by hand before the engine
 * existed. The contract findings of the report must match exactly (rules, statuses, evidence order and lines).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { describe, expect, it } from "vitest";
import { cli, Repo, type FileMap } from "../helpers.js";

type Json = Record<string, unknown>;

interface ExpectedEvidence {
  change: string;
  pointer: string;
  side: "base" | "head";
  base_line: number | null;
  head_line: number | null;
  detail_includes: string;
}

interface Expected {
  case: string;
  description: string;
  findings: {
    rule_id: string;
    status: string;
    severity: string;
    path: string;
    evidence: ExpectedEvidence[];
  }[];
  limitations: { code: string; paths_include: string[] }[];
  forbidden_rule_ids: string[];
  forbidden_strings: string[];
}

const root = fileURLToPath(new URL("./fixtures/", import.meta.url));
const schema = JSON.parse(
  readFileSync(new URL("../../schema/impact-check-report.schema.json", import.meta.url), "utf8")
);
const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => void;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

/** Reads a fixture tree into a FileMap with repository-relative paths. */
function readTree(dir: string, prefix = ""): FileMap {
  const files: FileMap = {};
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) Object.assign(files, readTree(full, `${prefix}${name}/`));
    else files[`${prefix}${name}`] = readFileSync(full, "utf8");
  }
  return files;
}

const project = (f: Json): Json => {
  const evidence = f["evidence"] as Json[];
  return {
    rule_id: f["rule_id"],
    status: f["status"],
    severity: f["severity"],
    path: evidence[0]?.["path"],
    evidence: evidence.map((e) => {
      const c = (e["contract"] ?? {}) as Json;
      return {
        change: c["change"],
        pointer: c["pointer"],
        side: e["side"],
        base_line: c["base_line"],
        head_line: c["head_line"],
      };
    }),
  };
};
const byRuleAndPath = (a: Json, b: Json): number =>
  `${a["rule_id"]}\0${a["path"]}` < `${b["rule_id"]}\0${b["path"]}` ? -1 : 1;

const cases = readdirSync(root)
  .filter((d) => statSync(join(root, d)).isDirectory())
  .sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));

describe("contract diff acceptance (I-C1 to I-C10)", () => {
  it("has all ten fixtures", () => {
    expect(cases).toEqual(Array.from({ length: 10 }, (_, i) => `i-c${i + 1}`));
  });

  for (const dir of cases) {
    const exp = JSON.parse(readFileSync(join(root, dir, "expected.json"), "utf8")) as Expected;
    it(`${exp.case}: ${exp.description}`, async () => {
      const base = readTree(join(root, dir, "base"));
      const head = readTree(join(root, dir, "head"));
      const repo = Repo.create({ ...base, "src/index.ts": "export const ok = true;\n" }).branch("feature");
      const removed = Object.keys(base).filter((p) => !(p in head));
      if (removed.length > 0) repo.remove(...removed);
      repo.write(head);
      const headCommit = repo.commit("contract change");
      const baseCommit = repo.git("rev-parse", "main");

      const run = await cli(
        ["analyze", "--format", "json", "--quiet", "--base", "main", "--head", "HEAD"],
        repo.dir
      );
      expect(run.code, run.stderr).toBe(0);
      const report = JSON.parse(run.stdout) as Json;
      if (!validate(report)) throw new Error(JSON.stringify(validate.errors, null, 2));

      const findings = report["findings"] as Json[];
      const contract = findings.filter((f) => String(f["rule_id"]).startsWith("contract-"));
      const wanted = exp.findings.map((f) => ({
        ...f,
        evidence: f.evidence.map(({ detail_includes: _detail, ...rest }) => rest),
      }));
      expect(contract.map(project).sort(byRuleAndPath), exp.case).toEqual(
        (wanted as unknown as Json[]).sort(byRuleAndPath)
      );

      for (const want of exp.findings) {
        const got = contract.find(
          (f) => f["rule_id"] === want.rule_id && (f["evidence"] as Json[])[0]?.["path"] === want.path
        ) as Json;
        expect(got["is_heuristic"]).toBe(want.status !== "verified_static_fact");
        expect(got["category"]).toBe("api-contract");
        expect(String(got["recommended_human_action"]).length).toBeGreaterThan(10);
        (got["evidence"] as Json[]).forEach((e, i) => {
          const w = want.evidence[i] as ExpectedEvidence;
          const line = w.side === "base" ? w.base_line : w.head_line;
          expect(e["kind"]).toBe("contract-element");
          expect(e["path"]).toBe(want.path);
          expect(e["line_start"]).toBe(line);
          expect(e["line_end"]).toBe(line);
          expect(e["commit"]).toBe(w.side === "base" ? baseCommit : headCommit);
          expect(String(e["detail"]), `${exp.case} ${w.pointer}`).toContain(w.detail_includes);
        });
      }

      for (const id of exp.forbidden_rule_ids)
        expect(
          findings.map((f) => f["rule_id"]),
          `${exp.case}: forbidden ${id}`
        ).not.toContain(id);
      const limitations = report["coverage_limitations"] as Json[];
      for (const l of exp.limitations) {
        const hit = limitations.find((x) => x["code"] === l.code);
        expect(hit, `${exp.case}: limitation ${l.code}`).toBeDefined();
        for (const p of l.paths_include) expect((hit as Json)["paths"]).toContain(p);
      }
      const markdown = await cli(["analyze", "--quiet", "--base", "main", "--head", "HEAD"], repo.dir);
      for (const s of exp.forbidden_strings) {
        expect(run.stdout, `${exp.case}: JSON contains ${s}`).not.toContain(s);
        expect(markdown.stdout, `${exp.case}: Markdown contains ${s}`).not.toContain(s);
      }
    });
  }
});
