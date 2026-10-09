import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll } from "vitest";
import { run } from "../src/cli/run.js";
import type { Report } from "../src/types.js";

export type FileMap = Record<string, string | Buffer>;

const created: string[] = [];
afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

export function tempDir(prefix = "cl-test-"): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  created.push(dir);
  return dir;
}

/** A synthetic git repository for tests. All git calls use argument arrays. */
export class Repo {
  constructor(readonly dir: string) {}

  static create(files: FileMap, options: { branch?: string } = {}): Repo {
    // Fixed directory name: `repository.name` (the basename) is part of the deterministic report.
    const dir = join(tempDir("cl-repo-"), "fixture-repo");
    mkdirSync(dir);
    const repo = new Repo(dir);
    repo.git("init", "-q", "-b", options.branch ?? "main");
    repo.git("config", "user.email", "test@example.invalid");
    repo.git("config", "user.name", "Impact Check Test");
    repo.git("config", "commit.gpgsign", "false");
    repo.write(files);
    repo.commit("initial");
    return repo;
  }

  git(...args: string[]): string {
    // Fixed identity and dates: fixture commit SHAs are identical on every run and machine (golden snapshots).
    const result = spawnSync(
      "git",
      ["-c", "core.hooksPath=/dev/null", "-c", "core.autocrlf=false", ...args],
      {
        cwd: this.dir,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Impact Check Test",
          GIT_AUTHOR_EMAIL: "test@example.invalid",
          GIT_COMMITTER_NAME: "Impact Check Test",
          GIT_COMMITTER_EMAIL: "test@example.invalid",
          GIT_AUTHOR_DATE: "2026-01-01T00:00:00+0000",
          GIT_COMMITTER_DATE: "2026-01-01T00:00:00+0000",
        },
      }
    );
    if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
    return result.stdout.trim();
  }

  write(files: FileMap): this {
    for (const [path, content] of Object.entries(files)) {
      const target = join(this.dir, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    return this;
  }

  remove(...paths: string[]): this {
    for (const path of paths) unlinkSync(join(this.dir, path));
    return this;
  }

  commit(message: string): string {
    this.git("add", "-A");
    this.git("commit", "-q", "--allow-empty", "-m", message);
    return this.git("rev-parse", "HEAD");
  }

  branch(name: string): this {
    this.git("checkout", "-q", "-b", name);
    return this;
  }
}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function cli(args: string[], cwd: string): Promise<CliResult> {
  let stdout = "";
  let stderr = "";
  const code = await run(args, {
    cwd,
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  return { code, stdout, stderr };
}

export async function analyzeJson(cwd: string, args: string[] = []): Promise<Report> {
  const result = await cli(["analyze", "--format", "json", "--quiet", ...args], cwd);
  if (result.code !== 0) throw new Error(`analyze failed (${result.code}): ${result.stderr}`);
  return JSON.parse(result.stdout) as Report;
}

export const dependents = (report: Report): string[] =>
  report.affected_modules.filter((m) => m.reason === "dependent").map((m) => m.path);

export const ruleIds = (report: Report): string[] => report.findings.map((f) => f.rule_id);

export const limitationCodes = (report: Report): string[] => report.coverage_limitations.map((l) => l.code);
