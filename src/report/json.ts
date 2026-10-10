// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
/**
 * JSON reporter and report normalization (masks the run-specific metadata fields so that identical inputs
 * produce byte-identical output for determinism checks).
 */
import type { Report } from "../types.js";

/** Serializes a report as pretty-printed JSON with a trailing newline. */
export function renderJson(report: Report): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/** Copy of a report with run-specific metadata normalized, for determinism comparisons. */
export function normalizeReport(report: Report): Report {
  return {
    ...report,
    run_metadata: {
      ...report.run_metadata,
      generated_at: "1970-01-01T00:00:00.000Z",
      duration_ms: 0,
      timings_ms: {},
      node_version: "normalized",
    },
  };
}
