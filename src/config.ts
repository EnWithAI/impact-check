import { readFileSync } from "node:fs";
import { usageError } from "./errors.js";
import type { Severity } from "./types.js";

export interface Policy {
  /** Fail `check` when any finding has at least this severity. "none" disables. */
  failOnSeverity: Severity | "none";
  /** Fail `check` when any finding has one of these rule IDs. */
  failOnRules: string[];
  /** Fail `check` when more than this many modules are affected (null = no limit). */
  maxAffectedModules: number | null;
}

export interface Config {
  base: string | null;
  tsconfig: string | null;
  maxDepth: number;
  maxAffected: number;
  blastRadiusThreshold: number;
  ignorePaths: string[];
  securityPathPatterns: string[];
  branding: boolean;
  policy: Policy;
}

export const DEFAULT_CONFIG: Config = {
  base: null,
  tsconfig: null,
  maxDepth: 10,
  maxAffected: 500,
  blastRadiusThreshold: 10,
  ignorePaths: [],
  securityPathPatterns: [],
  branding: true,
  policy: { failOnSeverity: "high", failOnRules: [], maxAffectedModules: null },
};

const SEVERITIES = ["high", "medium", "low", "info", "none"];
const MAX_CONFIG_BYTES = 256 * 1024;

function fail(source: string, message: string): never {
  throw usageError(`Invalid config (${source}): ${message}`, "See docs/CONFIG.md for the supported fields.");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function checkKeys(source: string, where: string, value: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(source, `unknown field "${where}${key}"`);
  }
}

function positiveInt(source: string, name: string, value: unknown, max: number, min = 1): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    fail(source, `"${name}" must be an integer between ${min} and ${max}`);
  }
  return value;
}

function stringList(source: string, name: string, value: unknown): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || v.length === 0 || v.length > 512)) {
    fail(source, `"${name}" must be an array of non-empty strings`);
  }
  if (value.length > 200) fail(source, `"${name}" has too many entries (max 200)`);
  return value as string[];
}

function optionalString(source: string, name: string, value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 512)
    fail(source, `"${name}" must be a string`);
  return value;
}

/** Validate an already-parsed config object. Config is data only: no code, no user-supplied regexes. */
export function parseConfig(raw: unknown, source: string): Config {
  if (!isObject(raw)) fail(source, "top level must be a JSON object");
  checkKeys(source, "", raw, [
    "$schema",
    "base",
    "tsconfig",
    "maxDepth",
    "maxAffected",
    "blastRadiusThreshold",
    "ignorePaths",
    "securityPathPatterns",
    "branding",
    "policy",
  ]);
  const config: Config = structuredClone(DEFAULT_CONFIG);
  if ("base" in raw) config.base = optionalString(source, "base", raw["base"]);
  if ("tsconfig" in raw) config.tsconfig = optionalString(source, "tsconfig", raw["tsconfig"]);
  if ("maxDepth" in raw) config.maxDepth = positiveInt(source, "maxDepth", raw["maxDepth"], 100);
  if ("maxAffected" in raw)
    config.maxAffected = positiveInt(source, "maxAffected", raw["maxAffected"], 100_000);
  if ("blastRadiusThreshold" in raw)
    config.blastRadiusThreshold = positiveInt(
      source,
      "blastRadiusThreshold",
      raw["blastRadiusThreshold"],
      100_000
    );
  if ("ignorePaths" in raw) config.ignorePaths = stringList(source, "ignorePaths", raw["ignorePaths"]);
  if ("securityPathPatterns" in raw)
    config.securityPathPatterns = stringList(source, "securityPathPatterns", raw["securityPathPatterns"]);
  if ("branding" in raw) {
    if (typeof raw["branding"] !== "boolean") fail(source, `"branding" must be a boolean`);
    config.branding = raw["branding"];
  }
  if ("policy" in raw) {
    const policy = raw["policy"];
    if (!isObject(policy)) fail(source, `"policy" must be an object`);
    checkKeys(source, "policy.", policy, ["failOnSeverity", "failOnRules", "maxAffectedModules"]);
    if ("failOnSeverity" in policy) {
      const value = policy["failOnSeverity"];
      if (typeof value !== "string" || !SEVERITIES.includes(value)) {
        fail(source, `"policy.failOnSeverity" must be one of ${SEVERITIES.join(", ")}`);
      }
      config.policy.failOnSeverity = value as Policy["failOnSeverity"];
    }
    if ("failOnRules" in policy)
      config.policy.failOnRules = stringList(source, "policy.failOnRules", policy["failOnRules"]);
    if ("maxAffectedModules" in policy) {
      const value = policy["maxAffectedModules"];
      config.policy.maxAffectedModules =
        value === null ? null : positiveInt(source, "policy.maxAffectedModules", value, 10_000_000, 0);
    }
  }
  return config;
}

export function parseConfigText(text: string, source: string): Config {
  if (text.length > MAX_CONFIG_BYTES) fail(source, "file is too large");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    fail(source, `not valid JSON (${(error as Error).message})`);
  }
  return parseConfig(raw, source);
}

export function loadConfigFile(path: string): Config {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw usageError(
      `Cannot read config file ${JSON.stringify(path)}: ${(error as NodeJS.ErrnoException).code ?? "error"}`
    );
  }
  return parseConfigText(text, path);
}

/** Convert a simple glob (`*`, `**`, `?`) to an anchored RegExp. No user regex syntax is honored. */
export function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i] as string;
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        const slash = glob[i + 2] === "/";
        out += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}
