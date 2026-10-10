// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
/**
 * GitHub Action entry point (composite action, see action.yml). All inputs arrive as environment variables set
 * via `env:` in action.yml — never interpolated into shell. The action only reads the checked-out repository,
 * writes report files and the job summary, and never executes repository code.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { analyze } from "../analysis/analyze.js";
import { DEFAULT_CONFIG, loadConfigFile, parseConfigText, type Config } from "../config.js";
import { ImpactCheckError, ExitCode, usageError } from "../errors.js";
import { repoRoot, showFile, validateRef } from "../git/repo.js";
import { evaluatePolicy } from "../policy.js";
import { renderJson } from "../report/json.js";
import { renderMarkdown } from "../report/markdown.js";
import { isSafeRelativePath } from "../util/classify.js";

/** Environment variables as seen by the action (inputs arrive as INPUT_* variables). */
export type Env = Record<string, string | undefined>;

const SUMMARY_LIMIT = 60_000;

/** Reads an action input (INPUT_<NAME>), trimmed; empty values fall back to the default. */
function input(env: Env, name: string, fallback = ""): string {
  const value = env[`INPUT_${name.toUpperCase().replace(/-/g, "_")}`];
  return value === undefined || value.trim() === "" ? fallback : value.trim();
}

/** Reads a boolean input; only "true"/"false" are accepted. */
function bool(env: Env, name: string, fallback: boolean): boolean {
  const value = input(env, name, String(fallback)).toLowerCase();
  if (value !== "true" && value !== "false") throw usageError(`Input "${name}" must be "true" or "false"`);
  return value === "true";
}

/** Reads an optional positive integer input. */
function int(env: Env, name: string): number | undefined {
  const value = input(env, name);
  if (value === "") return undefined;
  if (!/^\d+$/.test(value) || Number(value) < 1)
    throw usageError(`Input "${name}" must be a positive integer`);
  return Number(value);
}

/** Reads the webhook event payload; returns {} when unavailable or malformed. */
function readEvent(env: Env): Record<string, unknown> {
  const path = env["GITHUB_EVENT_PATH"];
  if (!path || !existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Base commit SHA of a pull_request event, if present and well-formed. */
function eventBaseSha(event: Record<string, unknown>): string | null {
  const pr = event["pull_request"] as { base?: { sha?: unknown } } | undefined;
  const sha = pr?.base?.sha;
  return typeof sha === "string" && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha) ? sha : null;
}

/** Appends a single-line step output to $GITHUB_OUTPUT (multi-line values are refused to prevent injection). */
function setOutput(env: Env, name: string, value: string): void {
  const file = env["GITHUB_OUTPUT"];
  if (!file) return;
  if (/[\r\n]/.test(value)) throw new Error(`Refusing to write multi-line output ${name}`);
  appendFileSync(file, `${name}=${value}\n`);
}

/** Loads the policy config from the base commit (default), the PR head, or nowhere (defaults). */
async function loadConfig(env: Env, cwd: string, base: string): Promise<{ config: Config; source: string }> {
  const source = input(env, "config-source", "base");
  const path = input(env, "config-path", ".impact-check.json");
  if (!isSafeRelativePath(path)) throw usageError(`Input "config-path" must be a repository-relative path`);
  if (source === "none") return { config: DEFAULT_CONFIG, source: "defaults" };
  if (source === "head") {
    const full = join(cwd, path);
    return existsSync(full)
      ? { config: loadConfigFile(full), source: `${path} (head)` }
      : { config: DEFAULT_CONFIG, source: "defaults" };
  }
  if (source !== "base") throw usageError(`Input "config-source" must be base, head or none`);
  // Default: read the config from the base commit so a pull request cannot weaken its own policy.
  const root = await repoRoot(cwd);
  const resolvedBase = await showFile(root, base, path).catch(() => null);
  if (resolvedBase === null) return { config: DEFAULT_CONFIG, source: "defaults" };
  return {
    config: parseConfigText(resolvedBase.toString("utf8"), `${path} @ base`),
    source: `${path} (base)`,
  };
}

/**
 * Runs one Action invocation: validates inputs, loads the policy config (from the base commit by
 * default), analyzes, writes report files, job summary and step outputs.
 * @returns the process exit code (0 ok, 2 usage, 3 repository, 4 policy, 1 internal). With on-error=warn, tool
 * errors return 0 after a warning (fail-open).
 */
export async function runAction(env: Env, log: (line: string) => void = console.log): Promise<number> {
  // Explicit fail-open/fail-closed per check type (addendum invariant 6). `auto`: a blocking policy check
  // (fail-on-policy: true) fails closed on tool errors; an informational report fails open with a warning.
  let onError: "fail" | "warn" = "fail";
  try {
    const failOnPolicy = bool(env, "fail-on-policy", false);
    const onErrorInput = input(env, "on-error", "auto");
    if (!["auto", "fail", "warn"].includes(onErrorInput))
      throw usageError(`Input "on-error" must be auto, fail or warn`);
    onError = onErrorInput === "auto" ? (failOnPolicy ? "fail" : "warn") : (onErrorInput as "fail" | "warn");
    const workspace = env["GITHUB_WORKSPACE"] ?? process.cwd();
    const cwd = resolve(workspace, input(env, "working-directory", "."));
    if (cwd !== workspace && !cwd.startsWith(workspace + sep))
      throw usageError(`"working-directory" must stay inside the workspace`);
    const event = readEvent(env);
    const rawBase = input(env, "base") || eventBaseSha(event);
    if (!rawBase) {
      throw usageError(
        "No base ref: the event has no pull_request.base.sha and the `base` input is empty",
        "Use the action on pull_request events, or set `base:` (e.g. origin/main) and check out with fetch-depth: 0."
      );
    }
    const base = validateRef(rawBase, "base");
    const head = validateRef(input(env, "head", "HEAD"), "head");
    const diffMode = input(env, "diff-mode", "merge-base");
    if (diffMode !== "merge-base" && diffMode !== "direct")
      throw usageError(`Input "diff-mode" must be merge-base or direct`);
    const outputDir = input(env, "output-dir", "impact-check-report");
    if (!isSafeRelativePath(outputDir))
      throw usageError(`Input "output-dir" must be a relative path inside the workspace`);
    const { config, source } = await loadConfig(env, cwd, base);
    log(`Impact Check: base ${base}, head ${head}, mode ${diffMode}, config from ${source}`);

    const maxDepth = int(env, "max-depth");
    const maxAffected = int(env, "max-affected");
    const report = await analyze({
      cwd,
      base,
      head,
      diffMode,
      config,
      ...(maxDepth !== undefined ? { maxDepth } : {}),
      ...(maxAffected !== undefined ? { maxAffected } : {}),
      log: (m) => log(`Impact Check: ${m}`),
      configSource: source,
    });
    const policy = evaluatePolicy(report, config.policy);
    const markdown = renderMarkdown(report, { branding: config.branding, maxChars: SUMMARY_LIMIT });

    const outDir = join(workspace, outputDir);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "impact-check-report.json"), renderJson(report));
    writeFileSync(
      join(outDir, "impact-check-report.md"),
      renderMarkdown(report, { branding: config.branding })
    );
    if (env["GITHUB_STEP_SUMMARY"]) appendFileSync(env["GITHUB_STEP_SUMMARY"], markdown);

    setOutput(env, "report-json", `${outputDir}/impact-check-report.json`);
    setOutput(env, "report-markdown", `${outputDir}/impact-check-report.md`);
    setOutput(env, "high-findings", String(report.summary.findings_by_severity.high));
    setOutput(env, "affected-modules", String(report.summary.affected_modules));
    setOutput(env, "policy", policy.passed ? "passed" : "failed");
    setOutput(env, "status", "ok");
    for (const violation of policy.violations)
      log(`::warning title=Impact Check policy::${violation.replace(/[\r\n]/g, " ")}`);
    if (!policy.passed && failOnPolicy) {
      log("::error title=Impact Check::Policy failed (fail-on-policy is true)");
      return ExitCode.Policy;
    }
    return ExitCode.Ok;
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).replace(/[\r\n]/g, " ");
    const usage = error instanceof ImpactCheckError && error.exitCode === ExitCode.Usage;
    if (onError === "warn" && !usage) {
      // Fail-open: the informational check could not run; say so loudly but do not block the PR.
      log(
        `::warning title=Impact Check::Impact Check could not analyze this change (on-error=warn, fail-open): ${message}`
      );
      if (error instanceof ImpactCheckError && error.hint) log(`Impact Check hint: ${error.hint}`);
      try {
        setOutput(env, "status", "error");
      } catch {
        /* ignore */
      }
      return ExitCode.Ok;
    }
    log(`::error title=Impact Check::${message}`);
    if (error instanceof ImpactCheckError) {
      if (error.hint) log(`Impact Check hint: ${error.hint}`);
      return error.exitCode;
    }
    return ExitCode.Internal;
  }
}
