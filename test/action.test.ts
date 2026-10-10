// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
/**
 * GitHub Action entry point under a simulated runner environment, base-branch policy configuration, input
 * validation, re-rendering of tampered artifacts, and a security lint of every workflow file.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runAction, type Env } from "../src/action/run.js";
import { cli, Repo, tempDir } from "./helpers.js";
import { basicTs } from "./fixtures/basic-ts.js";

const root = fileURLToPath(new URL("..", import.meta.url));

function prEnv(
  repo: Repo,
  baseSha: string,
  inputs: Record<string, string> = {}
): { env: Env; summary: string; output: string } {
  const dir = tempDir();
  const event = join(dir, "event.json");
  writeFileSync(
    event,
    JSON.stringify({
      pull_request: { number: 7, base: { sha: baseSha }, title: "$(rm -rf /) `@here` <script>" },
    })
  );
  const summary = join(dir, "summary.md");
  const output = join(dir, "output.txt");
  writeFileSync(summary, "");
  writeFileSync(output, "");
  const env: Env = {
    GITHUB_WORKSPACE: repo.dir,
    GITHUB_EVENT_PATH: event,
    GITHUB_STEP_SUMMARY: summary,
    GITHUB_OUTPUT: output,
  };
  for (const [k, v] of Object.entries(inputs)) env[`INPUT_${k.toUpperCase().replace(/-/g, "_")}`] = v;
  return { env, summary, output };
}

describe("GitHub Action (acceptance J) — local simulation", () => {
  it("analyzes a PR from the event payload and writes artifacts, summary and outputs", async () => {
    const repo = Repo.create(basicTs);
    const baseSha = repo.git("rev-parse", "HEAD");
    repo.branch("pr");
    repo.remove("src/utils/format.ts");
    repo.commit("break");
    const { env, summary, output } = prEnv(repo, baseSha);
    const logs: string[] = [];
    expect(await runAction(env, (l) => logs.push(l))).toBe(0);
    expect(readFileSync(summary, "utf8")).toContain("# Impact Check report");
    const outputs = Object.fromEntries(
      readFileSync(output, "utf8")
        .trim()
        .split("\n")
        .map((l) => l.split("=") as [string, string])
    );
    expect(outputs).toEqual({
      "report-json": "impact-check-report/impact-check-report.json",
      "report-markdown": "impact-check-report/impact-check-report.md",
      "high-findings": "1",
      "affected-modules": expect.any(String),
      policy: "failed",
      status: "ok",
    });
    const report = JSON.parse(readFileSync(join(repo.dir, outputs["report-json"]!), "utf8"));
    expect(report.base_revision.commit).toBe(baseSha);
    expect(logs.some((l) => l.startsWith("::warning title=Impact Check policy::"))).toBe(true);
    // PR title from the event is never used or echoed.
    expect(logs.join("\n") + readFileSync(summary, "utf8")).not.toContain("rm -rf");

    const strict = prEnv(repo, baseSha, { "fail-on-policy": "true" });
    expect(await runAction(strict.env, () => undefined)).toBe(4);
  });

  it("reads policy config from the base commit so a PR cannot weaken it", async () => {
    const repo = Repo.create({
      ...basicTs,
      ".impact-check.json": JSON.stringify({ policy: { failOnSeverity: "medium" } }),
    });
    const baseSha = repo.git("rev-parse", "HEAD");
    repo.branch("pr");
    repo.write({
      "src/auth/session.ts": basicTs["src/auth/session.ts"] + "//\n",
      ".impact-check.json": JSON.stringify({ policy: { failOnSeverity: "none" } }),
    });
    repo.commit("weaken policy");
    expect(await runAction(prEnv(repo, baseSha, { "fail-on-policy": "true" }).env, () => undefined)).toBe(4);
    expect(
      await runAction(
        prEnv(repo, baseSha, { "fail-on-policy": "true", "config-source": "head" }).env,
        () => undefined
      )
    ).toBe(0);
    expect(
      await runAction(
        prEnv(repo, baseSha, { "fail-on-policy": "true", "config-source": "none" }).env,
        () => undefined
      )
    ).toBe(0);
  });

  it("rejects unsafe inputs and missing base with clear errors", async () => {
    const repo = Repo.create(basicTs);
    const sha = repo.git("rev-parse", "HEAD");
    const cases: [Record<string, string>, string][] = [
      [{ "output-dir": "../escape" }, "output-dir"],
      [{ "working-directory": "../.." }, "working-directory"],
      [{ "config-path": "/etc/passwd" }, "config-path"],
      [{ "fail-on-policy": "yes" }, "fail-on-policy"],
      [{ base: "--upload-pack=evil" }, 'must not start with "-"'],
      [{ "diff-mode": "x" }, "diff-mode"],
      [{ "max-depth": "-1" }, "max-depth"],
      [{ "config-source": "url" }, "config-source"],
    ];
    for (const [inputs, expected] of cases) {
      const logs: string[] = [];
      expect(await runAction(prEnv(repo, sha, inputs).env, (l) => logs.push(l)), expected).toBe(2);
      expect(logs.join("\n")).toContain(expected);
    }
    const logs: string[] = [];
    expect(await runAction({ GITHUB_WORKSPACE: repo.dir }, (l) => logs.push(l))).toBe(2);
    expect(logs.join("\n")).toContain("No base ref");
  });

  it("render re-validates and re-escapes an untrusted artifact", async () => {
    const repo = Repo.create(basicTs).branch("f");
    repo.write({ "src/utils/unused.ts": "export const unused = 1;\n" });
    repo.commit("c");
    const result = await cli(
      ["analyze", "--base", "main", "--head", "HEAD", "--format", "json", "--quiet"],
      repo.dir
    );
    const report = JSON.parse(result.stdout);
    report.findings.push({
      ...report.findings[0],
      summary: "<img src=x onerror=alert(1)> @org/team [click](https://evil.invalid)",
    });
    const dir = tempDir();
    writeFileSync(join(dir, "r.json"), JSON.stringify(report));
    const rendered = await cli(["render", "--input", "r.json"], dir);
    expect(rendered.code).toBe(0);
    expect(rendered.stdout).toContain("\\<img src=x onerror=alert(1)\\>");
    expect(rendered.stdout).toContain("@​org/team");
    expect(rendered.stdout).toContain("\\[click\\]");
    writeFileSync(join(dir, "bad.json"), JSON.stringify({ ...report, findings: [{ title: 1 }] }));
    expect((await cli(["render", "--input", "bad.json"], dir)).code).toBe(2);
    writeFileSync(join(dir, "bad2.json"), "not json");
    expect((await cli(["render", "--input", "bad2.json"], dir)).code).toBe(2);
    expect((await cli(["render"], dir)).code).toBe(2);
  });
});

describe("workflow and action.yml security lint (T8)", () => {
  const files = [
    "action.yml",
    ...readdirSync(join(root, ".github/workflows")).map((f) => `.github/workflows/${f}`),
    ...readdirSync(join(root, "examples/workflows")).map((f) => `examples/workflows/${f}`),
  ];
  it.each(files)("%s follows least-privilege rules", (file) => {
    const text = readFileSync(join(root, file), "utf8");
    const code = text.replace(/^\s*#.*$/gm, "");
    expect(code).not.toMatch(/pull_request_target/);
    for (const m of code.matchAll(/uses:\s*([^\s#]+)/g)) {
      const ref = m[1]!;
      if (ref.startsWith("./")) continue;
      expect(ref, `${file}: ${ref}`).toMatch(/@([0-9a-f]{40}|<RELEASE_COMMIT_SHA>)$/);
    }
    // No ${{ }} expressions inside run: scripts (script injection); they must go through env:.
    const runBlocks = [
      ...code.matchAll(/run:\s*(\|[\s\S]*?)(?=\n\s*-\s|\n\s*\w[\w-]*:\s|\n*$)|run:\s*(.+)/g),
    ].map((m) => m[1] ?? m[2] ?? "");
    for (const block of runBlocks) expect(block, file).not.toContain("${{");
    if (file !== "action.yml") {
      expect(code).toMatch(/^permissions:\s*\n\s+contents:\s*read\s*$/m);
      expect(code).not.toMatch(/write-all|contents:\s*write/);
    }
  });
});
