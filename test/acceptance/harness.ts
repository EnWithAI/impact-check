// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
// Verification-first harness: expectations are hand-written JSON files in ./expected, authored before the analyzers
// they test. A report must contain everything listed and nothing forbidden.
import { readFileSync } from "node:fs";
import { expect } from "vitest";

export interface ExpectedEvidence {
  path: string;
  side?: "base" | "head";
  line_start?: number | null;
  detail_includes?: string;
  commit?: "head" | "base" | null;
}

export interface ExpectedFinding {
  rule_id: string;
  status: "verified_static_fact" | "hypothesis" | "unknown";
  severity?: string;
  summary_includes?: string;
  evidence?: ExpectedEvidence[];
  affected_modules_include?: string[];
}

export interface Expectation {
  case: string;
  description: string;
  analysis_mode?: "full" | "degraded";
  affected_dependents?: Record<string, { distance: number; evidence?: ExpectedEvidence }> | "none";
  findings?: ExpectedFinding[];
  forbidden_rule_ids?: string[];
  max_severity?: "high" | "medium" | "low" | "info";
  limitations?: { code: string; paths_include?: string[] }[];
  test_candidates_include?: string[];
}

export function loadExpectation(name: string): Expectation {
  return JSON.parse(readFileSync(new URL(`./expected/${name}.json`, import.meta.url), "utf8")) as Expectation;
}

type Json = Record<string, unknown>;
const ORDER = { info: 0, low: 1, medium: 2, high: 3 } as const;

function matchEvidence(
  actual: Json[],
  e: ExpectedEvidence,
  commits: { head: string | null; base: string },
  where: string
): void {
  const hit = actual.find(
    (a) =>
      a["path"] === e.path &&
      (e.side === undefined || a["side"] === e.side) &&
      (e.line_start === undefined || a["line_start"] === e.line_start) &&
      (e.detail_includes === undefined || String(a["detail"]).includes(e.detail_includes)) &&
      (e.commit === undefined || a["commit"] === (e.commit === null ? null : commits[e.commit]))
  );
  expect(hit, `${where}: evidence ${JSON.stringify(e)} not found in ${JSON.stringify(actual)}`).toBeDefined();
}

export function assertExpectation(report: Json, exp: Expectation): void {
  const summary = report["summary"] as Json;
  const repoRev = report["repo_revision"] as Json;
  const baseRev = report["base_revision"] as Json;
  const commits = {
    head: repoRev["kind"] === "worktree" ? null : (repoRev["commit"] as string),
    base: ((baseRev["merge_base"] as string | null) ?? baseRev["commit"]) as string,
  };
  if (exp.analysis_mode) expect(summary["analysis_mode"], exp.case).toBe(exp.analysis_mode);

  const modules = report["affected_modules"] as Json[];
  const dependents = modules.filter((m) => m["reason"] === "dependent");
  if (exp.affected_dependents === "none") expect(dependents, exp.case).toEqual([]);
  else if (exp.affected_dependents) {
    expect(dependents.map((m) => m["path"]).sort(), `${exp.case}: dependents (exact set)`).toEqual(
      Object.keys(exp.affected_dependents).sort()
    );
    for (const [path, want] of Object.entries(exp.affected_dependents)) {
      const m = dependents.find((d) => d["path"] === path) as Json;
      expect(m["distance"], `${exp.case}: ${path} distance`).toBe(want.distance);
      if (want.evidence)
        matchEvidence(m["evidence"] as Json[], want.evidence, commits, `${exp.case}: ${path}`);
    }
  }

  const findings = report["findings"] as Json[];
  for (const f of exp.findings ?? []) {
    const candidates = findings.filter(
      (a) =>
        a["rule_id"] === f.rule_id &&
        (f.summary_includes === undefined || String(a["summary"]).includes(f.summary_includes))
    );
    expect(
      candidates.length,
      `${exp.case}: finding ${f.rule_id} ${f.summary_includes ?? ""} missing; got ${findings.map((x) => `${x["rule_id"]}:${x["summary"]}`).join(" | ")}`
    ).toBeGreaterThan(0);
    const a = candidates[0] as Json;
    expect(a["status"], `${exp.case}: ${f.rule_id} status`).toBe(f.status);
    expect(a["is_heuristic"], `${exp.case}: ${f.rule_id} is_heuristic`).toBe(
      f.status !== "verified_static_fact"
    );
    expect(String(a["recommended_human_action"]).length, `${exp.case}: ${f.rule_id} action`).toBeGreaterThan(
      10
    );
    if (f.severity) expect(a["severity"], `${exp.case}: ${f.rule_id} severity`).toBe(f.severity);
    for (const e of f.evidence ?? [])
      matchEvidence(a["evidence"] as Json[], e, commits, `${exp.case}: ${f.rule_id}`);
    for (const m of f.affected_modules_include ?? []) expect(a["affected_modules"] as string[]).toContain(m);
  }
  for (const id of exp.forbidden_rule_ids ?? []) {
    expect(
      findings.map((f) => f["rule_id"]),
      `${exp.case}: forbidden ${id}`
    ).not.toContain(id);
  }
  if (exp.max_severity) {
    for (const f of findings) {
      expect(
        ORDER[f["severity"] as keyof typeof ORDER],
        `${exp.case}: ${f["rule_id"]} exceeds ${exp.max_severity}`
      ).toBeLessThanOrEqual(ORDER[exp.max_severity]);
    }
  }
  const limits = report["coverage_limitations"] as Json[];
  for (const l of exp.limitations ?? []) {
    const hit = limits.find((x) => x["code"] === l.code);
    expect(
      hit,
      `${exp.case}: limitation ${l.code} missing; got ${limits.map((x) => x["code"]).join(", ")}`
    ).toBeDefined();
    for (const p of l.paths_include ?? []) expect((hit as Json)["paths"] as string[]).toContain(p);
  }
  const tests = (report["test_candidates"] as Json[]).map((t) => t["path"]);
  for (const t of exp.test_candidates_include ?? [])
    expect(tests, `${exp.case}: test candidate ${t}`).toContain(t);
  for (const t of report["test_candidates"] as Json[]) expect(t["execution_status"]).toBe("not_run");
}

/** Fields that legitimately vary between runs (see schema description). */
export function normalize(report: Json): Json {
  const meta = {
    ...(report["run_metadata"] as Json),
    generated_at: "<generated_at>",
    duration_ms: 0,
    timings_ms: {},
    node_version: "<node>",
  };
  return { ...report, run_metadata: meta };
}
