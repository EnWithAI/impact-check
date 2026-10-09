import type { Report } from "../types.js";

export function renderJson(report: Report): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/** Copy of a report with run-specific metadata normalized, for determinism comparisons. */
export function normalizeReport(report: Report): Report {
  return { ...report, generatedAt: "1970-01-01T00:00:00.000Z" };
}
