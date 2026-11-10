import { SEVERITY_ORDER } from "./types.js";
/** Applies the configured policy to a report (severity threshold, rule list, affected-module limit). */
export function evaluatePolicy(report, policy) {
    const violations = [];
    if (policy.failOnSeverity !== "none") {
        const threshold = SEVERITY_ORDER[policy.failOnSeverity];
        const hits = report.findings.filter((f) => SEVERITY_ORDER[f.severity] >= threshold);
        if (hits.length > 0) {
            violations.push(`${hits.length} finding(s) at or above severity "${policy.failOnSeverity}": ${hits.map((f) => f.id).join(", ")}`);
        }
    }
    if (policy.failOnRules.length > 0) {
        const hits = report.findings.filter((f) => policy.failOnRules.includes(f.rule_id));
        if (hits.length > 0)
            violations.push(`${hits.length} finding(s) from rules ${policy.failOnRules.join(", ")}: ${hits.map((f) => f.id).join(", ")}`);
    }
    if (policy.maxAffectedModules !== null && report.summary.affected_modules > policy.maxAffectedModules) {
        violations.push(`${report.summary.affected_modules} affected modules exceeds maxAffectedModules ${policy.maxAffectedModules}`);
    }
    return { passed: violations.length === 0, violations };
}
