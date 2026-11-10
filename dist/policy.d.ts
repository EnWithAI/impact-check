/**
 * Policy evaluation for `impact-check check`. Turns a report plus the configured policy into pass/fail
 * with human-readable violations. A policy result is a signal for humans; it never approves or merges anything.
 */
import type { Policy } from "./config.js";
import type { Report } from "./types.js";
/** Outcome of a policy evaluation; `violations` explains every failure. */
export interface PolicyResult {
    passed: boolean;
    violations: string[];
}
/** Applies the configured policy to a report (severity threshold, rule list, affected-module limit). */
export declare function evaluatePolicy(report: Report, policy: Policy): PolicyResult;
