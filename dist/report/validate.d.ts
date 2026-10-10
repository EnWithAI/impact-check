import type { Report } from "../types.js";
/**
 * Parses and structurally validates a schema 2.0 report.
 * @throws ImpactCheckError (exit 2) when the input is not a valid report.
 */
export declare function parseReport(text: string): Report;
