// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
// Report contract types (schema 2.0). Must stay in sync with schema/impact-check-report.schema.json (validated in tests).
export const SCHEMA_VERSION = "2.0";
/** Numeric order of severities, used for sorting and policy thresholds. */
export const SEVERITY_ORDER = { high: 3, medium: 2, low: 1, info: 0 };
