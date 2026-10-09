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
  if (raw["schemaVersion"] !== "1.0") fail(`unsupported schemaVersion`);
  strings(raw, ["toolVersion", "generatedAt"], "report");
  for (const key of ["repository", "comparison", "summary", "analysis"])
    if (!isObj(raw[key])) fail(`${key} must be an object`);
  const comparison = raw["comparison"] as Record<string, unknown>;
  strings(
    comparison,
    ["baseRef", "baseCommit", "diffMode", "headRef", "headCommit", "headKind"],
    "comparison"
  );
  if (!isObj(comparison["worktree"])) fail("comparison.worktree must be an object");
  const summary = raw["summary"] as Record<string, unknown>;
  for (const k of [
    "filesChanged",
    "jsTsFilesChanged",
    "affectedModules",
    "suggestedTests",
    "coverageLimitations",
  ]) {
    if (!Number.isInteger(summary[k])) fail(`summary.${k} must be an integer`);
  }
  if (!isObj(summary["findingsBySeverity"])) fail("summary.findingsBySeverity must be an object");
  const analysis = raw["analysis"] as Record<string, unknown>;
  strings(analysis, ["engineVersion", "parserVersion"], "analysis");
  if (!isObj(analysis["headGraph"])) fail("analysis.headGraph must be an object");

  list(raw, "filesChanged", "report", (f, at) => {
    strings(f, ["path", "status", "kind", "origin"], at);
    if (f["previousPath"] !== null && typeof f["previousPath"] !== "string") fail(`${at}.previousPath`);
  });
  list(raw, "affectedModules", "report", (m, at) => {
    strings(m, ["path", "reason", "provenance"], at);
    if (!Number.isInteger(m["distance"])) fail(`${at}.distance must be an integer`);
    stringArray(m, "via", at);
  });
  list(raw, "riskFindings", "report", (f, at) => {
    strings(f, ["id", "ruleId", "title", "explanation", "confidence"], at);
    oneOf(f, "severity", ["high", "medium", "low", "info"], at);
    oneOf(f, "provenance", ["observed", "graph", "inferred"], at);
    if (typeof f["isHeuristic"] !== "boolean") fail(`${at}.isHeuristic must be a boolean`);
    list(f, "evidence", at, (e, eat) => {
      strings(e, ["path", "side", "detail"], eat);
      for (const k of ["line", "endLine"]) if (e[k] !== null && !Number.isInteger(e[k])) fail(`${eat}.${k}`);
    });
  });
  list(raw, "suggestedTests", "report", (t, at) => {
    strings(t, ["path", "provenance"], at);
    stringArray(t, "reasons", at);
  });
  list(raw, "coverageLimitations", "report", (l, at) => {
    strings(l, ["code", "message"], at);
    stringArray(l, "paths", at);
    if (!Number.isInteger(l["count"])) fail(`${at}.count must be an integer`);
  });
  return raw as unknown as Report;
}
