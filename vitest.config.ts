// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
/**
 * Vitest configuration: test discovery, process isolation (forks), generous timeouts for git-heavy tests and
 * coverage thresholds for src/.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: "forks",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/cli/main.ts"],
      reporter: ["text-summary", "text", "json-summary"],
      thresholds: { lines: 80, branches: 70, functions: 80, statements: 80 },
    },
  },
});
