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
function readJsonVersion(url: URL): string {
  const parsed = JSON.parse(readFileSync(url, "utf8")) as { version?: unknown };
  return typeof parsed.version === "string" ? parsed.version : "0.0.0";
}

/** Impact Check version (works from both src/ and dist/: package.json is one level up). */
export const TOOL_VERSION: string = readJsonVersion(new URL("../package.json", import.meta.url));

/** Resolve a dependency's package.json by walking up from its entry point (works despite `exports` maps). */
function dependencyVersion(name: string): string {
  try {
    let dir = dirname(fileURLToPath(import.meta.resolve(name)));
    for (let i = 0; i < 6; i++) {
      const candidate = join(dir, "package.json");
      if (existsSync(candidate)) {
        const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { name?: unknown; version?: unknown };
        if (parsed.name === name && typeof parsed.version === "string") return parsed.version;
      }
      dir = dirname(dir);
    }
  } catch {
    // fall through
  }
  return "unknown";
}

/** Version of the installed dependency-cruiser engine. */
export const ENGINE_VERSION: string = dependencyVersion("dependency-cruiser");
/** Version of the installed TypeScript parser. */
export const PARSER_VERSION: string = dependencyVersion("typescript");
