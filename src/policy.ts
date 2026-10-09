import type { Policy } from "./config.js";
import type { Report } from "./types.js";
import { SEVERITY_ORDER } from "./types.js";

export interface PolicyResult {
  passed: boolean;
  violations: string[];
}

export function evaluatePolicy(report: Report, policy: Policy): PolicyResult {
  const violations: string[] = [];
  if (policy.failOnSeverity !== "none") {
    const threshold = SEVERITY_ORDER[policy.failOnSeverity];
    const hits = report.riskFindings.filter((f) => SEVERITY_ORDER[f.severity] >= threshold);
    if (hits.length > 0) {
      violations.push(
        `${hits.length} finding(s) at or above severity "${policy.failOnSeverity}": ${hits.map((f) => f.id).join(", ")}`
      );
    }
  }
  if (policy.failOnRules.length > 0) {
    const hits = report.riskFindings.filter((f) => policy.failOnRules.includes(f.ruleId));
    if (hits.length > 0)
      violations.push(
        `${hits.length} finding(s) from rules ${policy.failOnRules.join(", ")}: ${hits.map((f) => f.id).join(", ")}`
      );
  }
  if (policy.maxAffectedModules !== null && report.summary.affectedModules > policy.maxAffectedModules) {
    violations.push(
      `${report.summary.affectedModules} affected modules exceeds maxAffectedModules ${policy.maxAffectedModules}`
    );
  }
  return { passed: violations.length === 0, violations };
}
