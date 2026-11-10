import type { Severity } from "./types.js";
/** Policy applied by `impact-check check`. */
export interface Policy {
    /** Fail `check` when any finding has at least this severity. "none" disables. */
    failOnSeverity: Severity | "none";
    /** Fail `check` when any finding has one of these rule IDs. */
    failOnRules: string[];
    /** Fail `check` when more than this many modules are affected (null = no limit). */
    maxAffectedModules: number | null;
}
/** Validated configuration with defaults applied. See docs/CONFIG.md. */
export interface Config {
    base: string | null;
    tsconfig: string | null;
    maxDepth: number;
    maxAffected: number;
    blastRadiusThreshold: number;
    ignorePaths: string[];
    securityPathPatterns: string[];
    branding: boolean;
    /** Optional repository conventions (addendum: "optional repository conventions file"). */
    conventions: {
        testPatterns: string[];
        generatedPaths: string[];
    };
    policy: Policy;
}
/** Defaults used when no config file exists or a field is omitted. */
export declare const DEFAULT_CONFIG: Config;
/** Validate an already-parsed config object. Config is data only: no code, no user-supplied regexes. */
export declare function parseConfig(raw: unknown, source: string): Config;
/**
 * Parses and validates JSON config text.
 * @throws ImpactCheckError (exit 2) for invalid JSON, unknown fields or invalid values.
 */
export declare function parseConfigText(text: string, source: string): Config;
/**
 * Reads and validates a config file from disk.
 * @throws ImpactCheckError (exit 2) when unreadable or invalid.
 */
export declare function loadConfigFile(path: string): Config;
/** Convert a simple glob (`*`, `**`, `?`) to an anchored RegExp. No user regex syntax is honored. */
export declare function globToRegExp(glob: string): RegExp;
/** True when the path matches at least one glob. */
export declare function matchesAny(path: string, globs: readonly string[]): boolean;
