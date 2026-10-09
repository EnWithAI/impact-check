/**
 * Hardened git process runner. Every git call goes through runGit(): argument arrays (never a shell),
 * a minimal environment, configuration that disables fsmonitor and external tools, no lazy network fetches,
 * timeouts and output caps.
 */
import { spawn } from "node:child_process";
import { repoError } from "../errors.js";

/** Options for a single git invocation. */
export interface GitOptions {
  cwd: string;
  input?: Buffer | string;
  timeoutMs?: number;
  maxBytes?: number;
  /** Return result instead of throwing on non-zero exit. */
  allowFailure?: boolean;
}

/** Raw result of a git invocation. */
export interface GitResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

/**
 * Hardened git configuration applied to every invocation. Disables mechanisms that could run
 * repository- or user-configured programs, or reach the network.
 */
const SAFE_CONFIG = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.quotepath=false",
  "-c",
  "core.untrackedCache=false",
  "-c",
  "diff.noprefix=false",
  "-c",
  "color.ui=false",
  "-c",
  "protocol.allow=never",
];

/**
 * Minimal environment for git: only what it needs to locate itself and the repository, plus variables
 * that disable prompts, optional locks, pagers and lazy (network) object fetches.
 */
export function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  // Pass through only what git needs to locate itself and the repository.
  for (const key of ["PATH", "HOME", "SystemRoot", "TMPDIR", "TEMP", "TMP", "USERPROFILE"]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  env["GIT_TERMINAL_PROMPT"] = "0";
  env["GIT_OPTIONAL_LOCKS"] = "0";
  env["GIT_NO_LAZY_FETCH"] = "1";
  env["GIT_PAGER"] = "cat";
  env["LC_ALL"] = "C";
  return env;
}

/** Run git with an argument array (never a shell string). */
export function runGit(args: readonly string[], options: GitOptions): Promise<GitResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn("git", [...SAFE_CONFIG, ...args], {
        cwd: options.cwd,
        env: gitEnv(),
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      reject(
        repoError(`Unable to start git: ${(error as Error).message}`, "Install git and ensure it is on PATH.")
      );
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = "";
    let overflow = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        overflow = true;
        child.kill("SIGKILL");
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 64 * 1024) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(repoError(`Unable to run git: ${error.message}`, "Install git and ensure it is on PATH."));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(repoError(`git ${args[0] ?? ""} timed out after ${timeoutMs} ms`));
        return;
      }
      if (overflow) {
        reject(repoError(`git ${args[0] ?? ""} produced more than ${maxBytes} bytes of output`));
        return;
      }
      const result: GitResult = { code: code ?? -1, stdout: Buffer.concat(chunks), stderr };
      if (result.code !== 0 && !options.allowFailure) {
        reject(repoError(`git ${args[0] ?? ""} failed: ${firstLine(stderr)}`));
        return;
      }
      resolve(result);
    });
    child.stdin.on("error", () => {
      /* child may exit before consuming stdin; handled via close */
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

/** First non-empty line of a message, capped at 300 characters (used to summarize git stderr). */
export function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  return line.length > 300 ? `${line.slice(0, 300)}…` : line;
}

/** Split NUL-separated git output. */
export function splitZ(buffer: Buffer): string[] {
  const text = buffer.toString("utf8");
  const parts = text.split("\0");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}
