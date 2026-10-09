/**
 * Git edge cases: rename/delete/add/binary, empty diffs, missing or option-like refs, detached HEAD,
 * shallow clones, symlinks, dirty working trees and hostile file names.
 */
import { spawnSync } from "node:child_process";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeJson, cli, dependents, limitationCodes, Repo, ruleIds, tempDir } from "./helpers.js";
import { basicTs } from "./fixtures/basic-ts.js";

describe("git diff edge cases (acceptance G)", () => {
  it("classifies rename, deletion, new, binary and unrelated files", async () => {
    const repo = Repo.create(basicTs).branch("feature");
    repo.git("mv", "src/services/checkout.ts", "src/services/pay.ts");
    repo.write({ "src/index.ts": 'export * from "./services/pay";\n' });
    repo.remove("src/utils/unused.ts");
    repo.write({
      "src/new-feature.ts": "export const feature = true;\n",
      "assets/logo.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 1, 2, 3, 0, 255]),
      "docs/notes.md": "notes\n",
    });
    repo.commit("mixed");
    const report = await analyzeJson(repo.dir, ["--base", "main", "--head", "HEAD"]);
    const byPath = Object.fromEntries(report.changed_files.map((f) => [f.path, f]));
    expect(byPath["src/services/pay.ts"]).toMatchObject({
      status: "renamed",
      previous_path: "src/services/checkout.ts",
    });
    expect(byPath["src/utils/unused.ts"]).toMatchObject({ status: "deleted", changed_lines: [] });
    expect(byPath["src/new-feature.ts"]).toMatchObject({ status: "added", kind: "source" });
    expect(byPath["assets/logo.png"]).toMatchObject({ status: "added", binary: true, additions: null });
    expect(byPath["docs/notes.md"]).toMatchObject({ status: "added", kind: "other" });
    expect(limitationCodes(report)).toContain("binary-file");
    // Renamed module: its base dependent (src/index.ts) was updated, so no broken import.
    expect(ruleIds(report)).not.toContain("broken-import");
    const deleted = report.findings.find((f) => f.rule_id === "deleted-module-with-dependents");
    expect(deleted).toMatchObject({ severity: "low", is_heuristic: false, provenance: "graph" });
    expect(report.run_metadata.base_graph).not.toBeNull();
    // Sorted output
    const paths = report.changed_files.map((f) => f.path);
    expect(paths).toEqual([...paths].sort());
  });

  it("returns an empty, valid report when nothing changed", async () => {
    const repo = Repo.create(basicTs);
    const report = await analyzeJson(repo.dir, ["--base", "main", "--head", "HEAD"]);
    expect(report.summary).toMatchObject({ files_changed: 0, affected_modules: 0, test_candidates: 0 });
    expect(report.findings).toEqual([]);
  });

  it("fails with exit 3 and a remediation hint for a missing base ref", async () => {
    const repo = Repo.create(basicTs);
    const result = await cli(["analyze", "--base", "does-not-exist", "--quiet"], repo.dir);
    expect(result.code).toBe(3);
    expect(result.stderr).toContain('Base ref "does-not-exist" does not resolve to a commit');
    expect(result.stderr).toContain("hint:");
  });

  it("falls back from main to master when --base is omitted", async () => {
    const repo = Repo.create(basicTs, { branch: "master" }).branch("feature");
    repo.write({ "src/utils/unused.ts": "export const unused = 0;\n" });
    repo.commit("x");
    const report = await analyzeJson(repo.dir, ["--head", "HEAD"]);
    expect(report.base_revision.ref).toBe("master");
  });

  it("rejects option-like refs (exit 2) without invoking git with them", async () => {
    const repo = Repo.create(basicTs);
    const result = await cli(["analyze", "--base=--output=/tmp/pwned", "--quiet"], repo.dir);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('must not start with "-"');
  });

  it("fails with exit 3 outside a git repository", async () => {
    const result = await cli(["analyze", "--quiet"], tempDir());
    expect(result.code).toBe(3);
    expect(result.stderr).toContain("Not a git repository");
  });

  it("commit mode reports excluded uncommitted changes; worktree mode includes them with origins", async () => {
    const repo = Repo.create(basicTs).branch("feature");
    repo.write({ "src/utils/unused.ts": "export const unused = 1;\n" });
    repo.commit("committed change");
    repo.write({ "src/utils/format.ts": basicTs["src/utils/format.ts"] + "export const STAGED = 1;\n" });
    repo.git("add", "src/utils/format.ts");
    repo.write({
      "src/services/cart.ts": basicTs["src/services/cart.ts"] + "// unstaged\n",
      "src/scratch.ts": "export {};\n",
    });

    const commitMode = await analyzeJson(repo.dir, ["--base", "main", "--head", "HEAD"]);
    expect(commitMode.repo_revision.kind).toBe("commit");
    expect(commitMode.changed_files.map((f) => f.path)).toEqual(["src/utils/unused.ts"]);
    const excluded = commitMode.coverage_limitations.find((l) => l.code === "dirty-worktree-excluded");
    expect(excluded?.count).toBe(3);
    expect(commitMode.repo_revision.worktree).toEqual({
      included: false,
      staged: 1,
      unstaged: 1,
      untracked: 1,
    });

    const worktree = await analyzeJson(repo.dir, ["--base", "main"]);
    expect(worktree.repo_revision).toMatchObject({ kind: "worktree", ref: "WORKTREE" });
    const origins = Object.fromEntries(worktree.changed_files.map((f) => [f.path, f.origin]));
    expect(origins).toEqual({
      "src/scratch.ts": "untracked",
      "src/services/cart.ts": "unstaged",
      "src/utils/format.ts": "staged",
      "src/utils/unused.ts": "committed",
    });
    expect(limitationCodes(worktree)).not.toContain("dirty-worktree-excluded");
  });

  it("works on a detached HEAD", async () => {
    const repo = Repo.create(basicTs).branch("feature");
    repo.write({ "src/utils/unused.ts": "export const unused = 2;\n" });
    const sha = repo.commit("x");
    repo.git("checkout", "-q", "--detach", sha);
    const report = await analyzeJson(repo.dir, ["--base", "main", "--head", "HEAD"]);
    expect(report.repo_revision.commit).toBe(sha);
  });

  it("explains shallow clones that lack the merge base", async () => {
    const origin = Repo.create(basicTs);
    origin.write({ "a.ts": "export const a = 1;\n" });
    origin.commit("second");
    origin.branch("feature");
    origin.write({ "b.ts": "export const b = 1;\n" });
    origin.commit("third");
    const cloneDir = join(tempDir(), "clone");
    const clone = spawnSync(
      "git",
      ["clone", "-q", "--depth", "1", "--branch", "feature", `file://${origin.dir}`, cloneDir],
      { encoding: "utf8" }
    );
    expect(clone.status).toBe(0);
    spawnSync("git", ["fetch", "-q", "--depth", "1", "origin", "main:main"], { cwd: cloneDir });
    const result = await cli(["analyze", "--base", "main", "--head", "HEAD", "--quiet"], cloneDir);
    expect(result.code).toBe(3);
    expect(result.stderr).toMatch(/shallow clone/i);
    // --diff-mode direct works without a merge base
    const direct = await cli(
      ["analyze", "--base", "main", "--head", "HEAD", "--diff-mode", "direct", "--format", "json", "--quiet"],
      cloneDir
    );
    expect(direct.code).toBe(0);
    expect(JSON.parse(direct.stdout).repository.is_shallow).toBe(true);
  });

  it("skips symlinks instead of following them", async () => {
    const repo = Repo.create(basicTs).branch("feature");
    symlinkSync("/etc/hosts", join(repo.dir, "src/evil.ts"));
    repo.commit("symlink");
    const report = await analyzeJson(repo.dir, ["--base", "main", "--head", "HEAD"]);
    const symlinks = report.coverage_limitations.find((l) => l.code === "symlink-skipped");
    expect(symlinks?.paths).toEqual(["src/evil.ts"]);
    const worktree = await analyzeJson(repo.dir, ["--base", "main"]);
    expect(worktree.coverage_limitations.find((l) => l.code === "symlink-skipped")?.paths).toEqual([
      "src/evil.ts",
    ]);
  });

  it("handles filenames with spaces, unicode, quotes, backticks, newlines and markup", async () => {
    const names = [
      "src/with space.ts",
      "src/ünïcödé.ts",
      'src/quote"d.ts',
      "src/back`tick.ts",
      "src/new\nline.ts",
      "src/<img src=x onerror=alert(1)>.ts",
      "src/@everyone [link](javascript:alert(1)).ts",
      "src/$(touch pwned).ts",
    ];
    const files = Object.fromEntries(names.map((n) => [n, "export const v = 1;\n"]));
    const repo = Repo.create({
      ...basicTs,
      "src/consumer.ts": 'import { v } from "./with space";\nexport const w = v;\n',
      ...files,
    }).branch("feature");
    repo.write(Object.fromEntries(names.map((n) => [n, "export const v = 2;\n"])));
    repo.commit("weird names");
    const report = await analyzeJson(repo.dir, ["--base", "main", "--head", "HEAD"]);
    expect(report.changed_files.map((f) => f.path).sort()).toEqual([...names].sort());
    expect(dependents(report)).toEqual(["src/consumer.ts"]);
    const md = await cli(["analyze", "--base", "main", "--head", "HEAD", "--quiet"], repo.dir);
    expect(md.code).toBe(0);
    // Outside of inline code spans (where GitHub renders text literally) no live markup survives.
    // (an escaped backtick \` cannot open a code span, as in CommonMark)
    const outsideCode = md.stdout.replace(/\\`/g, "").replace(/(`+)(?:(?!\1)[\s\S])*?\1/g, "");
    expect(outsideCode).not.toContain("<img");
    expect(outsideCode).not.toContain("[link](javascript");
    expect(outsideCode).not.toMatch(/@everyone/);
    expect(md.stdout).toContain("src/new\\nline.ts");
    // No command substitution happened anywhere.
    expect(spawnSync("ls", [repo.dir]).stdout.toString()).not.toContain("pwned");
  });
});
