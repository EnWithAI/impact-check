// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
/**
 * Public library API of Impact Check. Re-exports the analysis entry point, reporters, policy
 * evaluation, configuration helpers, error types and the report contract types (schema 2.0).
 */
export { analyze } from "./analysis/analyze.js";
export { renderMarkdown } from "./report/markdown.js";
export { renderJson, normalizeReport } from "./report/json.js";
export { evaluatePolicy } from "./policy.js";
export { parseConfig, parseConfigText, loadConfigFile, DEFAULT_CONFIG, } from "./config.js";
export { ImpactCheckError, ExitCode } from "./errors.js";
export { TOOL_VERSION } from "./version.js";
