import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function readJsonVersion(url: URL): string {
  const parsed = JSON.parse(readFileSync(url, "utf8")) as { version?: unknown };
  return typeof parsed.version === "string" ? parsed.version : "0.0.0";
}

/** ChangeLens version (works from both src/ and dist/: package.json is one level up). */
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

export const ENGINE_VERSION: string = dependencyVersion("dependency-cruiser");
export const PARSER_VERSION: string = dependencyVersion("typescript");
