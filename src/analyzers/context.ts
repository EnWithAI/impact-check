// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
// Repository context detection (addendum invariant 2). Reads only names, counts and manifest fields.
import ts from "typescript";
import type { Snapshot } from "../snapshot/snapshot.js";
import type { RepositoryContext } from "../types.js";
import { parseJsonObject } from "../graph/workspaces.js";
import { basenameOf, extname } from "../util/classify.js";
import { compareStrings } from "./../analysis/limitations.js";

const LANGUAGES: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".json": "json",
  ".py": "python",
  ".go": "go",
  ".rb": "ruby",
  ".java": "java",
  ".kt": "kotlin",
  ".rs": "rust",
  ".cs": "csharp",
  ".php": "php",
  ".swift": "swift",
  ".scala": "scala",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".css": "css",
  ".scss": "css",
  ".html": "html",
  ".vue": "vue",
  ".svelte": "svelte",
  ".md": "markdown",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".sql": "sql",
  ".sh": "shell",
  ".graphql": "graphql",
  ".proto": "protobuf",
};

const WORKSPACE_MARKERS: Record<string, string> = {
  "pnpm-workspace.yaml": "pnpm",
  "lerna.json": "lerna",
  "nx.json": "nx",
  "turbo.json": "turbo",
  "rush.json": "rush",
};

const TEST_FRAMEWORKS: Record<string, string> = {
  vitest: "vitest",
  jest: "jest",
  mocha: "mocha",
  ava: "ava",
  jasmine: "jasmine",
  "@playwright/test": "playwright",
  cypress: "cypress",
  "@testing-library/react": "testing-library",
  uvu: "uvu",
  tap: "tap",
};

/**
 * Detects languages (by file count), module type, workspace tools, test frameworks and the tsconfig
 * module resolution of the analyzed snapshot.
 */
export function detectContext(snapshot: Snapshot, tsConfig: string | null): RepositoryContext {
  const counts = new Map<string, number>();
  const all = [...snapshot.files, ...snapshot.placeholders];
  for (const path of all) {
    const language = LANGUAGES[extname(path)];
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  const languages = [...counts.entries()]
    .sort(([a, x], [b, y]) => y - x || compareStrings(a, b))
    .slice(0, 12)
    .map(([language, files]) => ({ language, files }));

  const root = parseJsonObject(snapshot.read("package.json"));
  const moduleType: RepositoryContext["module_type"] = !root
    ? "unknown"
    : root["type"] === "module"
      ? "module"
      : "commonjs";

  const tools = new Set<string>();
  if (root && root["workspaces"] !== undefined) tools.add("package.json workspaces");
  for (const path of all) {
    if (!path.includes("/") && WORKSPACE_MARKERS[path]) tools.add(WORKSPACE_MARKERS[path] as string);
  }

  const frameworks = new Set<string>();
  for (const path of snapshot.files) {
    if (basenameOf(path) !== "package.json") continue;
    const manifest = parseJsonObject(snapshot.read(path));
    for (const field of ["dependencies", "devDependencies"]) {
      const deps = manifest?.[field];
      if (!deps || typeof deps !== "object") continue;
      for (const name of Object.keys(deps))
        if (TEST_FRAMEWORKS[name]) frameworks.add(TEST_FRAMEWORKS[name] as string);
    }
  }

  let moduleResolution: string | null = null;
  const tsText = tsConfig ? snapshot.read(tsConfig) : null;
  if (tsConfig && tsText) {
    const { config } = ts.parseConfigFileTextToJson(tsConfig, tsText) as {
      config?: { compilerOptions?: { moduleResolution?: unknown } };
    };
    const value = config?.compilerOptions?.moduleResolution;
    if (typeof value === "string") moduleResolution = value.toLowerCase();
  }

  return {
    languages,
    module_type: moduleType,
    workspace_tools: [...tools].sort(compareStrings),
    test_frameworks: [...frameworks].sort(compareStrings),
    module_resolution: moduleResolution,
  };
}
