import { usageError } from "../errors.js";
import type { Report } from "../types.js";

// Structural validation for reports read back from disk (e.g. a CI artifact produced by an untrusted PR run).
// Rendering escapes every string, so this guards against crashes and type confusion, not content.

const MAX_ITEMS = 100_000;

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function fail(message: string): never {
  throw usageError(`Invalid ChangeLens report: ${message}`);
}

function strings(obj: Record<string, unknown>, keys: string[], where: string): void {
  for (const k of keys) if (typeof obj[k] !== "string") fail(`${where}.${k} must be a string`);
}

function list(
  obj: Record<string, unknown>,
  key: string,
  where: string,
  each: (item: Record<string, unknown>, at: string) => void
): void {
  const value = obj[key];
  if (!Array.isArray(value) || value.length > MAX_ITEMS) fail(`${where}.${key} must be an array`);
  value.forEach((item, i) => {
    if (!isObj(item)) fail(`${where}.${key}[${i}] must be an object`);
    each(item, `${where}.${key}[${i}]`);
  });
}

function stringArray(obj: Record<string, unknown>, key: string, where: string): void {
  const value = obj[key];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string"))
    fail(`${where}.${key} must be an array of strings`);
}

const oneOf = (
  obj: Record<string, unknown>,
  key: string,
  values: readonly unknown[],
  where: string
): void => {
  if (!values.includes(obj[key])) fail(`${where}.${key} has an unexpected value`);
};

export function parseReport(text: string): Report {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    fail("not valid JSON");
  }
  if (!isObj(raw)) fail("top level must be an object");
  if (raw["schema_version"] !== "2.0") fail(`unsupported schema_version (expected "2.0")`);
  for (const key of ["repo_revision", "base_revision", "repository", "summary", "run_metadata"]) {
    if (!isObj(raw[key])) fail(`${key} must be an object`);
  }
  const head = raw["repo_revision"] as Record<string, unknown>;
  strings(head, ["ref", "commit", "kind"], "repo_revision");
  if (!isObj(head["worktree"])) fail("repo_revision.worktree must be an object");
  const base = raw["base_revision"] as Record<string, unknown>;
  strings(base, ["ref", "commit", "diff_mode"], "base_revision");
  if (base["merge_base"] !== null && typeof base["merge_base"] !== "string") fail("base_revision.merge_base");
  const summary = raw["summary"] as Record<string, unknown>;
  oneOf(summary, "analysis_mode", ["full", "degraded"], "summary");
  for (const k of [
    "files_changed",
    "js_ts_files_changed",
    "affected_modules",
    "test_candidates",
    "coverage_limitations",
  ]) {
    if (!Number.isInteger(summary[k])) fail(`summary.${k} must be an integer`);
  }
  for (const k of ["findings_by_severity", "findings_by_status"])
    if (!isObj(summary[k])) fail(`summary.${k} must be an object`);
  const meta = raw["run_metadata"] as Record<string, unknown>;
  strings(meta, ["tool_version", "generated_at", "engine_version", "parser_version"], "run_metadata");
  if (!isObj(meta["head_graph"])) fail("run_metadata.head_graph must be an object");

  const evidence = (e: Record<string, unknown>, at: string): void => {
    strings(e, ["path", "side", "detail"], at);
    for (const k of ["line_start", "line_end"])
      if (e[k] !== null && !Number.isInteger(e[k])) fail(`${at}.${k}`);
    if (e["commit"] !== null && typeof e["commit"] !== "string") fail(`${at}.commit`);
  };
  list(raw, "changed_files", "report", (f, at) => {
    strings(f, ["path", "status", "kind", "origin"], at);
    if (f["previous_path"] !== null && typeof f["previous_path"] !== "string") fail(`${at}.previous_path`);
    if (typeof f["generated"] !== "boolean") fail(`${at}.generated`);
  });
  list(raw, "affected_modules", "report", (m, at) => {
    strings(m, ["path", "reason", "provenance"], at);
    if (!Number.isInteger(m["distance"])) fail(`${at}.distance must be an integer`);
    stringArray(m, "via", at);
    list(m, "evidence", at, evidence);
  });
  list(raw, "findings", "report", (f, at) => {
    strings(f, ["id", "rule_id", "summary", "explanation", "confidence", "recommended_human_action"], at);
    oneOf(f, "severity", ["high", "medium", "low", "info"], at);
    oneOf(f, "status", ["verified_static_fact", "hypothesis", "unknown"], at);
    oneOf(f, "provenance", ["observed", "graph", "inferred"], at);
    if (typeof f["is_heuristic"] !== "boolean") fail(`${at}.is_heuristic must be a boolean`);
    stringArray(f, "affected_modules", at);
    list(f, "evidence", at, evidence);
  });
  list(raw, "test_candidates", "report", (t, at) => {
    strings(t, ["path", "provenance"], at);
    stringArray(t, "reasons", at);
    if (t["execution_status"] !== "not_run") fail(`${at}.execution_status must be "not_run"`);
  });
  list(raw, "coverage_limitations", "report", (l, at) => {
    strings(l, ["code", "message"], at);
    stringArray(l, "paths", at);
    if (!Number.isInteger(l["count"])) fail(`${at}.count must be an integer`);
  });
  return raw as unknown as Report;
}
