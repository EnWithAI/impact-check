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
export { ChangeLensError, ExitCode } from "./errors.js";
export { TOOL_VERSION } from "./version.js";
export type * from "./types.js";
