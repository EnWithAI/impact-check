// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
/**
 * Version information reported in run_metadata: the Impact Check package version and the exact versions
 * of the analysis engine (dependency-cruiser) and parser (TypeScript) resolved at runtime.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
/** Reads the `version` field of a package.json ("0.0.0" when absent). */
function readJsonVersion(url) {
    const parsed = JSON.parse(readFileSync(url, "utf8"));
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
}
/** Impact Check version (works from both src/ and dist/: package.json is one level up). */
export const TOOL_VERSION = readJsonVersion(new URL("../package.json", import.meta.url));
/** Resolve a dependency's package.json by walking up from its entry point (works despite `exports` maps). */
function dependencyVersion(name) {
    try {
        let dir = dirname(fileURLToPath(import.meta.resolve(name)));
        for (let i = 0; i < 6; i++) {
            const candidate = join(dir, "package.json");
            if (existsSync(candidate)) {
                const parsed = JSON.parse(readFileSync(candidate, "utf8"));
                if (parsed.name === name && typeof parsed.version === "string")
                    return parsed.version;
            }
            dir = dirname(dir);
        }
    }
    catch {
        // fall through
    }
    return "unknown";
}
/** Version of the installed dependency-cruiser engine. */
export const ENGINE_VERSION = dependencyVersion("dependency-cruiser");
/** Version of the installed TypeScript parser. */
export const PARSER_VERSION = dependencyVersion("typescript");
