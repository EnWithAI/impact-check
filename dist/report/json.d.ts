/**
 * JSON reporter and report normalization (masks the run-specific metadata fields so that identical inputs
 * produce byte-identical output for determinism checks).
 */
import type { Report } from "../types.js";
/** Serializes a report as pretty-printed JSON with a trailing newline. */
export declare function renderJson(report: Report): string;
/** Copy of a report with run-specific metadata normalized, for determinism comparisons. */
export declare function normalizeReport(report: Report): Report;
