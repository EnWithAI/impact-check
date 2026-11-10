/**
 * Markdown reporter for humans and PR job summaries. All repository-derived text is escaped, paths are
 * rendered as inert code spans, and the report states up front that repository strings are data, not instructions.
 */
import type { Report } from "../types.js";
/** Rendering options for the Markdown report. */
export interface MarkdownOptions {
    branding: boolean;
    /** Max rows per table section; the JSON report always has the full lists. */
    maxRows?: number;
    /** Hard cap on output size (characters). GitHub job summaries/comments are limited. */
    maxChars?: number;
}
/**
 * Render free text that may embed repository paths: known paths become code spans (inert), the rest is escaped
 * text. This keeps instruction-like file names out of rendered prose.
 */
export declare function withPaths(value: string, paths: readonly string[]): string;
/**
 * Renders a report as Markdown: summary table, findings with status and recommended action, changed
 * files, affected modules with import evidence, test candidates and limitations.
 */
export declare function renderMarkdown(report: Report, options: MarkdownOptions): string;
