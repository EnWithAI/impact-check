// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
/**
 * Public library API of Impact Check. Re-exports the analysis and graph entry points, the contract diff, reporters, policy
 * evaluation, configuration helpers, error types and the report contract types (schema 2.0).
 */
export { analyze, type AnalyzeOptions } from "./analysis/analyze.js";
export { exportGraph, GRAPH_SCHEMA_VERSION, type GraphExport, type GraphOptions } from "./graph/export.js";
export { diffContract, type ContractItem, type ContractResult } from "./analyzers/contract.js";
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
