// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
/**
 * Configuration (.impact-check.json): defaults, strict validation and simple glob matching.
 * Configuration is data only: no JavaScript configs, no user-supplied regular expressions, unknown keys rejected.
 */
import { readFileSync } from "node:fs";
import { usageError } from "./errors.js";
/** Defaults used when no config file exists or a field is omitted. */
export const DEFAULT_CONFIG = {
    base: null,
    tsconfig: null,
    maxDepth: 10,
    maxAffected: 500,
    blastRadiusThreshold: 10,
    ignorePaths: [],
    securityPathPatterns: [],
    branding: true,
    conventions: { testPatterns: [], generatedPaths: [] },
    policy: { failOnSeverity: "high", failOnRules: [], maxAffectedModules: null },
};
const SEVERITIES = ["high", "medium", "low", "info", "none"];
const MAX_CONFIG_BYTES = 256 * 1024;
/** Throws a usage error describing an invalid config field. */
function fail(source, message) {
    throw usageError(`Invalid config (${source}): ${message}`, "See docs/CONFIG.md for the supported fields.");
}
/** True for plain (non-array) objects. */
function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Rejects unknown fields so that typos never silently disable a setting. */
function checkKeys(source, where, value, allowed) {
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key))
            fail(source, `unknown field "${where}${key}"`);
    }
}
/** Validates an integer within [min, max]. */
function positiveInt(source, name, value, max, min = 1) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
        fail(source, `"${name}" must be an integer between ${min} and ${max}`);
    }
    return value;
}
/** Validates a bounded list of non-empty strings. */
function stringList(source, name, value) {
    if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || v.length === 0 || v.length > 512)) {
        fail(source, `"${name}" must be an array of non-empty strings`);
    }
    if (value.length > 200)
        fail(source, `"${name}" has too many entries (max 200)`);
    return value;
}
/** Validates a non-empty string or null. */
function optionalString(source, name, value) {
    if (value === null)
        return null;
    if (typeof value !== "string" || value.length === 0 || value.length > 512)
        fail(source, `"${name}" must be a string`);
    return value;
}
/** Validate an already-parsed config object. Config is data only: no code, no user-supplied regexes. */
export function parseConfig(raw, source) {
    if (!isObject(raw))
        fail(source, "top level must be a JSON object");
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
        "conventions",
        "policy",
    ]);
    const config = structuredClone(DEFAULT_CONFIG);
    if ("base" in raw)
        config.base = optionalString(source, "base", raw["base"]);
    if ("tsconfig" in raw)
        config.tsconfig = optionalString(source, "tsconfig", raw["tsconfig"]);
    if ("maxDepth" in raw)
        config.maxDepth = positiveInt(source, "maxDepth", raw["maxDepth"], 100);
    if ("maxAffected" in raw)
        config.maxAffected = positiveInt(source, "maxAffected", raw["maxAffected"], 100_000);
    if ("blastRadiusThreshold" in raw)
        config.blastRadiusThreshold = positiveInt(source, "blastRadiusThreshold", raw["blastRadiusThreshold"], 100_000);
    if ("ignorePaths" in raw)
        config.ignorePaths = stringList(source, "ignorePaths", raw["ignorePaths"]);
    if ("securityPathPatterns" in raw)
        config.securityPathPatterns = stringList(source, "securityPathPatterns", raw["securityPathPatterns"]);
    if ("branding" in raw) {
        if (typeof raw["branding"] !== "boolean")
            fail(source, `"branding" must be a boolean`);
        config.branding = raw["branding"];
    }
    if ("conventions" in raw) {
        const conventions = raw["conventions"];
        if (!isObject(conventions))
            fail(source, `"conventions" must be an object`);
        checkKeys(source, "conventions.", conventions, ["testPatterns", "generatedPaths"]);
        if ("testPatterns" in conventions)
            config.conventions.testPatterns = stringList(source, "conventions.testPatterns", conventions["testPatterns"]);
        if ("generatedPaths" in conventions)
            config.conventions.generatedPaths = stringList(source, "conventions.generatedPaths", conventions["generatedPaths"]);
    }
    if ("policy" in raw) {
        const policy = raw["policy"];
        if (!isObject(policy))
            fail(source, `"policy" must be an object`);
        checkKeys(source, "policy.", policy, ["failOnSeverity", "failOnRules", "maxAffectedModules"]);
        if ("failOnSeverity" in policy) {
            const value = policy["failOnSeverity"];
            if (typeof value !== "string" || !SEVERITIES.includes(value)) {
                fail(source, `"policy.failOnSeverity" must be one of ${SEVERITIES.join(", ")}`);
            }
            config.policy.failOnSeverity = value;
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
/**
 * Parses and validates JSON config text.
 * @throws ImpactCheckError (exit 2) for invalid JSON, unknown fields or invalid values.
 */
export function parseConfigText(text, source) {
    if (text.length > MAX_CONFIG_BYTES)
        fail(source, "file is too large");
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch (error) {
        fail(source, `not valid JSON (${error.message})`);
    }
    return parseConfig(raw, source);
}
/**
 * Reads and validates a config file from disk.
 * @throws ImpactCheckError (exit 2) when unreadable or invalid.
 */
export function loadConfigFile(path) {
    let text;
    try {
        text = readFileSync(path, "utf8");
    }
    catch (error) {
        throw usageError(`Cannot read config file ${JSON.stringify(path)}: ${error.code ?? "error"}`);
    }
    return parseConfigText(text, path);
}
/** Convert a simple glob (`*`, `**`, `?`) to an anchored RegExp. No user regex syntax is honored. */
export function globToRegExp(glob) {
    let out = "";
    for (let i = 0; i < glob.length; i++) {
        const ch = glob[i];
        if (ch === "*") {
            if (glob[i + 1] === "*") {
                const slash = glob[i + 2] === "/";
                out += slash ? "(?:.*/)?" : ".*";
                i += slash ? 2 : 1;
            }
            else {
                out += "[^/]*";
            }
        }
        else if (ch === "?") {
            out += "[^/]";
        }
        else {
            out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
        }
    }
    return new RegExp(`^${out}$`);
}
/** True when the path matches at least one glob. */
export function matchesAny(path, globs) {
    return globs.some((g) => globToRegExp(g).test(path));
}
