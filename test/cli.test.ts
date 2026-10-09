import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cli, Repo, tempDir } from "./helpers.js";
import { basicTs } from "./fixtures/basic-ts.js";
import { TOOL_VERSION } from "../src/version.js";

describe("CLI contract (acceptance A)", () => {
  it("--help and --version work without a repository, network or API keys", async () => {
    const dir = tempDir();
    const help = await cli(["--help"], dir);
    expect(help.code).toBe(0);
    for (const flag of [
      "--base",
      "--head",
      "--worktree",
      "--diff-mode",
      "--format",
      "--output",
      "--config",
      "--offline",
      "--max-depth",
    ]) {
      expect(help.stdout).toContain(flag);
    }
    expect((await cli(["-v"], dir)).stdout.trim()).toBe(TOOL_VERSION);
    expect((await cli([], dir)).code).toBe(2);
  });

  it("rejects bad usage with exit code 2", async () => {
    const repo = Repo.create(basicTs);
    const cases: string[][] = [
      ["frobnicate"],
      ["analyze", "--format", "xml"],
      ["analyze", "--diff-mode", "sideways"],
      ["analyze", "--head", "HEAD", "--worktree"],
      ["analyze", "--max-depth", "0"],
      ["analyze", "--unknown-flag"],
      ["analyze", "extra"],
      ["analyze", "--cwd", "does/not/exist"],
      ["analyze", "--output", join(repo.dir, "missing-dir", "r.md")],
      ["analyze", "--config", "nope.json"],
    ];
    for (const args of cases) {
      const result = await cli([...args, "--quiet"], repo.dir);
      expect(result.code, args.join(" ")).toBe(2);
      expect(result.stderr).toMatch(/error:/);
    }
  });

  it("writes markdown and json to --output files and accepts --offline", async () => {
    const repo = Repo.create(basicTs).branch("f");
    repo.write({ "src/utils/unused.ts": "export const unused = 5;\n" });
    repo.commit("c");
    const md = await cli(
      [
        "analyze",
        "--base",
        "main",
        "--head",
        "HEAD",
        "--format",
        "markdown",
        "--output",
        "impact-check-report.md",
        "--offline",
      ],
      repo.dir
    );
    expect(md.code).toBe(0);
    expect(md.stdout).toBe("");
    expect(md.stderr).toContain("Report written to impact-check-report.md");
    expect(readFileSync(join(repo.dir, "impact-check-report.md"), "utf8")).toContain("# Impact Check report");
    const json = await cli(
      ["analyze", "--base", "main", "--head", "HEAD", "--format", "json", "--output", "r.json", "--quiet"],
      repo.dir
    );
    expect(json.code).toBe(0);
    expect(JSON.parse(readFileSync(join(repo.dir, "r.json"), "utf8")).schema_version).toBe("2.0");
  });

  it("--cwd points at a repository from elsewhere, including a subdirectory", async () => {
    const repo = Repo.create(basicTs);
    const result = await cli(
      ["analyze", "--cwd", join(repo.dir, "src"), "--base", "main", "--format", "json", "--quiet"],
      tempDir()
    );
    expect(result.code).toBe(0);
  });
});

describe("check command and policy (exit 4 distinct from errors)", () => {
  it("passes by default on heuristic-only findings and fails on confirmed broken imports", async () => {
    const repo = Repo.create(basicTs).branch("f");
    repo.write({ "src/auth/session.ts": basicTs["src/auth/session.ts"] + "//\n" });
    repo.commit("medium only");
    expect((await cli(["check", "--base", "main", "--head", "HEAD", "--quiet"], repo.dir)).code).toBe(0);
    repo.remove("src/utils/format.ts");
    repo.commit("break");
    const failed = await cli(["check", "--base", "main", "--head", "HEAD", "--quiet"], repo.dir);
    expect(failed.code).toBe(4);
    expect(failed.stderr).toMatch(
      /policy violation: \d+ finding\(s\) at or above severity "high": broken-import:[0-9a-f]{8}/
    );
  });

  it("loads .impact-check.json from the repository root and honors custom policy", async () => {
    const repo = Repo.create(basicTs).branch("f");
    repo.write({ "src/auth/session.ts": basicTs["src/auth/session.ts"] + "//\n" });
    repo.commit("c");
    writeFileSync(
      join(repo.dir, ".impact-check.json"),
      JSON.stringify({ policy: { failOnSeverity: "medium" }, branding: false })
    );
    const result = await cli(["check", "--base", "main", "--head", "HEAD", "--quiet"], repo.dir);
    expect(result.code).toBe(4);
    expect(result.stdout).not.toContain("crewpe.ai");
    const rules = join(tempDir(), "c.json");
    writeFileSync(
      rules,
      JSON.stringify({ policy: { failOnSeverity: "none", failOnRules: ["security-sensitive-change"] } })
    );
    expect(
      (await cli(["check", "--base", "main", "--head", "HEAD", "--config", rules, "--quiet"], repo.dir)).code
    ).toBe(4);
    writeFileSync(rules, JSON.stringify({ policy: { failOnSeverity: "none", maxAffectedModules: 0 } }));
    expect(
      (await cli(["check", "--base", "main", "--head", "HEAD", "--config", rules, "--quiet"], repo.dir)).code
    ).toBe(4);
    writeFileSync(rules, JSON.stringify({ policy: { failOnSeverity: "none" } }));
    expect(
      (await cli(["check", "--base", "main", "--head", "HEAD", "--config", rules, "--quiet"], repo.dir)).code
    ).toBe(0);
  });

  it("applies ignorePaths, securityPathPatterns and limits from config", async () => {
    const repo = Repo.create(basicTs).branch("f");
    mkdirSync(join(repo.dir, "billing"), { recursive: true });
    repo.write({ "billing/charge.ts": "export const charge = 1;\n", "generated/api.ts": "export {};\n" });
    repo.commit("c");
    const cfg = join(tempDir(), "c.json");
    writeFileSync(
      cfg,
      JSON.stringify({ ignorePaths: ["generated/**"], securityPathPatterns: ["billing/**"], maxDepth: 2 })
    );
    const result = await cli(
      ["analyze", "--base", "main", "--head", "HEAD", "--config", cfg, "--format", "json", "--quiet"],
      repo.dir
    );
    const report = JSON.parse(result.stdout);
    expect(report.changed_files.map((f: { path: string }) => f.path)).toEqual(["billing/charge.ts"]);
    expect(
      report.coverage_limitations.find((l: { code: string }) => l.code === "ignored-by-config").paths
    ).toEqual(["generated/api.ts"]);
    expect(
      report.findings.some(
        (f: { rule_id: string; affected_modules: string[] }) =>
          f.rule_id === "security-sensitive-change" && f.affected_modules.includes("billing/charge.ts")
      )
    ).toBe(true);
    expect(report.run_metadata.limits.max_depth).toBe(2);
  });
});
