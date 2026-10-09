import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { analyze } from "../analysis/analyze.js";
import { DEFAULT_CONFIG, loadConfigFile, type Config } from "../config.js";
import { ChangeLensError, ExitCode, usageError } from "../errors.js";
import { repoRoot } from "../git/repo.js";
import { evaluatePolicy } from "../policy.js";
import { renderJson } from "../report/json.js";
import { renderMarkdown } from "../report/markdown.js";
import { redactDeep } from "../report/redact.js";
import { parseReport } from "../report/validate.js";
import { TOOL_VERSION } from "../version.js";

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
  now?: () => Date;
}

export const HELP = `ChangeLens ${TOOL_VERSION} — evidence-backed change-impact reports for JS/TS repositories.

Usage:
  changelens analyze [options]   Analyze changes and print/write a report (exit 0 unless a fatal error occurs)
  changelens check   [options]   Analyze, then apply the policy from the config (exit 4 on policy failure)
  changelens schema              Print the JSON Schema of the report
  changelens render --input <report.json> [--format markdown|json] [--output <file>]
                                 Re-render a saved JSON report (validates it; escapes all content)
  changelens --help | --version

Options:
  --base <ref>             Base ref (default: main, then origin/main, master, origin/master)
  --head <ref>             Analyze this commit. Without --head the working tree is analyzed
                           (staged + unstaged + untracked files)
  --worktree               Analyze the working tree explicitly (cannot be combined with --head)
  --diff-mode <mode>       merge-base (default; GitHub PR semantics) or direct
  --format <fmt>           markdown (default) or json
  --output <file>          Write the report to a file instead of stdout
  --config <file>          JSON config/policy (default: .changelens.json at the repository root, if present)
  --cwd <dir>              Repository directory (default: current directory)
  --tsconfig <file>        tsconfig/jsconfig for path aliases (default: tsconfig.json, then jsconfig.json)
  --max-depth <n>          Max reverse-dependency hops (default 10)
  --max-affected <n>       Max affected modules listed (default 500)
  --offline                Accepted for explicitness: ChangeLens never uses the network
  --on-error <fail|pass>   Tool/git errors: fail (default; fail-closed, exit 1/3) or pass (fail-open: warn, exit 0).
                           Usage errors always exit 2; policy failures always exit 4
  --no-branding            Omit the footer line in Markdown output
  --quiet                  No progress messages on stderr
  -h, --help               Show this help
  -v, --version            Show the version

Exit codes: 0 ok · 1 internal error · 2 usage/config error · 3 git/repository error · 4 policy failure (check)
Privacy: no network access, no telemetry, no execution of repository code or package scripts.
`;

function positiveInt(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 1_000_000) {
    throw usageError(`${flag} must be a positive integer`);
  }
  return Number(value);
}

function writeOutput(path: string, content: string): void {
  if (existsSync(path) && statSync(path).isDirectory())
    throw usageError(`--output points to a directory: ${path}`);
  if (!existsSync(dirname(path))) throw usageError(`Output directory does not exist: ${dirname(path)}`);
  const temp = join(dirname(path), `.changelens-${process.pid}-${Date.now()}.tmp`);
  writeFileSync(temp, content, { mode: 0o644 });
  renameSync(temp, path);
}

export function readSchema(): string {
  return readFileSync(new URL("../../schema/changelens-report.schema.json", import.meta.url), "utf8");
}

/** Set by --on-error pass: tool/git errors become warnings with exit 0 (fail-open). */
let failOpen = false;

async function main(argv: string[], io: CliIO): Promise<number> {
  const { values, positionals } = (() => {
    try {
      return parseArgs({
        args: argv,
        allowPositionals: true,
        strict: true,
        options: {
          base: { type: "string" },
          input: { type: "string" },
          head: { type: "string" },
          worktree: { type: "boolean" },
          "diff-mode": { type: "string" },
          format: { type: "string" },
          output: { type: "string" },
          config: { type: "string" },
          cwd: { type: "string" },
          tsconfig: { type: "string" },
          "max-depth": { type: "string" },
          "max-affected": { type: "string" },
          offline: { type: "boolean" },
          "no-branding": { type: "boolean" },
          "on-error": { type: "string" },
          quiet: { type: "boolean" },
          help: { type: "boolean", short: "h" },
          version: { type: "boolean", short: "v" },
        },
      });
    } catch (error) {
      throw usageError((error as Error).message, "Run `changelens --help` for usage.");
    }
  })();

  if (values.help) {
    io.stdout(HELP);
    return ExitCode.Ok;
  }
  if (values.version) {
    io.stdout(`${TOOL_VERSION}\n`);
    return ExitCode.Ok;
  }
  const command = positionals[0];
  if (command === undefined) {
    io.stderr(HELP);
    return ExitCode.Usage;
  }
  if (positionals.length > 1) throw usageError(`Unexpected argument: ${positionals[1]}`);
  if (command === "schema") {
    io.stdout(readSchema());
    return ExitCode.Ok;
  }
  if (command === "render") {
    if (values.input === undefined) throw usageError("render requires --input <report.json>");
    const format = values.format ?? "markdown";
    if (format !== "markdown" && format !== "json") throw usageError(`--format must be "markdown" or "json"`);
    const inputPath = isAbsolute(values.input) ? values.input : resolve(io.cwd, values.input);
    let text: string;
    try {
      if (statSync(inputPath).size > 64 * 1024 * 1024) throw usageError("--input is too large");
      text = readFileSync(inputPath, "utf8");
    } catch (error) {
      if (error instanceof ChangeLensError) throw error;
      throw usageError(`Cannot read --input ${JSON.stringify(values.input)}`);
    }
    const report = redactDeep(parseReport(text));
    const rendered =
      format === "json" ? renderJson(report) : renderMarkdown(report, { branding: !values["no-branding"] });
    if (values.output !== undefined)
      writeOutput(isAbsolute(values.output) ? values.output : resolve(io.cwd, values.output), rendered);
    else io.stdout(rendered);
    return ExitCode.Ok;
  }
  if (command !== "analyze" && command !== "check") {
    throw usageError(`Unknown command: ${command}`, "Commands: analyze, check, render, schema.");
  }

  const onError = values["on-error"] ?? "fail";
  if (onError !== "fail" && onError !== "pass") throw usageError(`--on-error must be "fail" or "pass"`);
  failOpen = onError === "pass";
  if (values.head !== undefined && values.worktree)
    throw usageError("--head and --worktree cannot be combined");
  const format = values.format ?? "markdown";
  if (format !== "markdown" && format !== "json") throw usageError(`--format must be "markdown" or "json"`);
  const diffMode = values["diff-mode"] ?? "merge-base";
  if (diffMode !== "merge-base" && diffMode !== "direct")
    throw usageError(`--diff-mode must be "merge-base" or "direct"`);
  const maxDepth = positiveInt(values["max-depth"], "--max-depth");
  const maxAffected = positiveInt(values["max-affected"], "--max-affected");
  const cwd = values.cwd ? resolve(io.cwd, values.cwd) : io.cwd;
  if (!existsSync(cwd) || !statSync(cwd).isDirectory())
    throw usageError(`--cwd is not a directory: ${values.cwd ?? cwd}`);

  let config: Config = DEFAULT_CONFIG;
  let configSource = "defaults";
  if (values.config !== undefined) {
    configSource = "--config";
    config = loadConfigFile(isAbsolute(values.config) ? values.config : resolve(io.cwd, values.config));
  } else {
    const root = await repoRoot(cwd);
    const implicit = join(root, ".changelens.json");
    if (existsSync(implicit)) {
      config = loadConfigFile(implicit);
      configSource = ".changelens.json";
    }
  }

  const log = values.quiet ? undefined : (message: string): void => io.stderr(`changelens: ${message}\n`);
  const options = {
    cwd,
    base: values.base ?? null,
    head: values.head ?? null,
    diffMode: diffMode as "merge-base" | "direct",
    config,
    configSource,
    tsConfig: values.tsconfig ?? null,
    ...(maxDepth !== undefined ? { maxDepth } : {}),
    ...(maxAffected !== undefined ? { maxAffected } : {}),
    ...(io.now ? { now: io.now } : {}),
    ...(log ? { log } : {}),
  };
  const report = await analyze(options);
  const branding = config.branding && !values["no-branding"];
  const rendered = format === "json" ? renderJson(report) : renderMarkdown(report, { branding });

  if (values.output !== undefined) {
    const target = isAbsolute(values.output) ? values.output : resolve(io.cwd, values.output);
    writeOutput(target, rendered);
    log?.(`Report written to ${values.output}`);
  } else {
    io.stdout(rendered);
  }

  if (command === "check") {
    const policy = evaluatePolicy(report, config.policy);
    if (!policy.passed) {
      for (const violation of policy.violations) io.stderr(`changelens: policy violation: ${violation}\n`);
      return ExitCode.Policy;
    }
    log?.("Policy passed");
  }
  return ExitCode.Ok;
}

/** CLI entry point. Never throws; maps every error to a documented exit code. */
export async function run(argv: string[], io: CliIO): Promise<number> {
  failOpen = false;
  try {
    return await main(argv, io);
  } catch (error) {
    const usage = error instanceof ChangeLensError && error.exitCode === ExitCode.Usage;
    if (failOpen && !usage) {
      io.stderr(
        `changelens: warning: analysis failed and was ignored (on-error=pass, fail-open): ${(error as Error).message}\n`
      );
      return ExitCode.Ok;
    }
    if (error instanceof ChangeLensError) {
      io.stderr(`changelens: error: ${error.message}\n`);
      if (error.hint) io.stderr(`changelens: hint: ${error.hint}\n`);
      return error.exitCode;
    }
    io.stderr(`changelens: internal error: ${(error as Error)?.stack ?? String(error)}\n`);
    io.stderr(
      "changelens: this is a bug; please report it with the command you ran (no source code needed).\n"
    );
    return ExitCode.Internal;
  }
}
