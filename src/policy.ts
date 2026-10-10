// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
/**
 * Policy evaluation for `impact-check check`. Turns a report plus the configured policy into pass/fail
 * with human-readable violations. A policy result is a signal for humans; it never approves or merges anything.
 */
import type { Policy } from "./config.js";
import type { Report } from "./types.js";
import { SEVERITY_ORDER } from "./types.js";

/** Outcome of a policy evaluation; `violations` explains every failure. */
export interface PolicyResult {
  passed: boolean;
  violations: string[];
}

/** Applies the configured policy to a report (severity threshold, rule list, affected-module limit). */
export function evaluatePolicy(report: Report, policy: Policy): PolicyResult {
  const violations: string[] = [];
  if (policy.failOnSeverity !== "none") {
    const threshold = SEVERITY_ORDER[policy.failOnSeverity];
    const hits = report.findings.filter((f) => SEVERITY_ORDER[f.severity] >= threshold);
    if (hits.length > 0) {
      violations.push(
        `${hits.length} finding(s) at or above severity "${policy.failOnSeverity}": ${hits.map((f) => f.id).join(", ")}`
      );
    }
  }
  if (policy.failOnRules.length > 0) {
    const hits = report.findings.filter((f) => policy.failOnRules.includes(f.rule_id));
    if (hits.length > 0)
      violations.push(
        `${hits.length} finding(s) from rules ${policy.failOnRules.join(", ")}: ${hits.map((f) => f.id).join(", ")}`
      );
  }
  if (policy.maxAffectedModules !== null && report.summary.affected_modules > policy.maxAffectedModules) {
    violations.push(
      `${report.summary.affected_modules} affected modules exceeds maxAffectedModules ${policy.maxAffectedModules}`
    );
  }
  return { passed: violations.length === 0, violations };
}
