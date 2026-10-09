/**
 * Public library API of Impact Check. Re-exports the analysis entry point, reporters, policy
 * evaluation, configuration helpers, error types and the report contract types (schema 2.0).
 */
export { analyze, type AnalyzeOptions } from "./analysis/analyze.js";
export { renderMarkdown, type MarkdownOptions } from "./report/markdown.js";
export { renderJson, normalizeReport } from "./report/json.js";
export { evaluatePolicy, type PolicyResult } from "./policy.js";
export {
  parseConfig,
  parseConfigText,
  loadConfigFile,
  DEFAULT_CONFIG,
  type Config,
  type Policy,
} from "./config.js";
export { ImpactCheckError, ExitCode } from "./errors.js";
export { TOOL_VERSION } from "./version.js";
/** Report contract types (schema 2.0). */
export type * from "./types.js";
