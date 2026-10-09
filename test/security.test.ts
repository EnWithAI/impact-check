/**
 * Security invariants: no network/shell/eval primitives in src/, no execution of package scripts, JS configs
 * or hostile git configuration (with a positive control), no file contents or environment variables in output.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeJson, cli, Repo } from "./helpers.js";
import { basicTs } from "./fixtures/basic-ts.js";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("no execution, no network, no leakage (acceptance H, T1/T5/T7)", () => {
  it("source code contains no network, shell or eval primitives", () => {
    const src = fileURLToPath(new URL("../src", import.meta.url));
    for (const file of sourceFiles(src)) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/from "node:(http|https|net|tls|dgram|http2)"/);
      expect(text, file).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket/);
      expect(text, file).not.toMatch(/\bexecSync?\(|shell:\s*true|\beval\(|new Function\(/);
    }
  });

  it("never runs package scripts, JS configs, git fsmonitor, textconv or external diff", async () => {
    const canary = (name: string): string => `require("fs").writeFileSync(${JSON.stringify(name)}, "ran")`;
    const repo = Repo.create({
      ...basicTs,
      "package.json": JSON.stringify({
        name: "evil",
        scripts: Object.fromEntries(
          ["preinstall", "install", "postinstall", "prepare", "test", "build"].map((s) => [
            s,
            `node -e '${canary("CANARY_SCRIPT")}'`,
          ])
        ),
      }),
      ".dependency-cruiser.cjs": `${canary("CANARY_DEPCRUISE")}; module.exports = {};`,
      "webpack.config.js": `${canary("CANARY_WEBPACK")};`,
      "babel.config.js": `${canary("CANARY_BABEL")};`,
      ".gitattributes": "*.ts diff=evil\n",
      "hook.sh": `#!/bin/sh\ntouch "$(dirname "$0")/CANARY_GIT"\n`,
    }).branch("f");
    chmodSync(join(repo.dir, "hook.sh"), 0o755);
    repo.write({ "src/utils/format.ts": basicTs["src/utils/format.ts"] + "export const Y = 2;\n" });
    repo.commit("c");
    repo.write({ "src/utils/unused.ts": "export const unused = 9;\n" });
    // Hostile local git config is installed only after the test helper's last git call.
    repo.git("config", "core.fsmonitor", join(repo.dir, "hook.sh"));
    repo.git("config", "diff.evil.textconv", join(repo.dir, "hook.sh"));
    repo.git("config", "diff.external", join(repo.dir, "hook.sh"));
    expect(existsSync(join(repo.dir, "CANARY_GIT"))).toBe(false);
    await analyzeJson(repo.dir, ["--base", "main", "--head", "HEAD"]);
    await analyzeJson(repo.dir, ["--base", "main"]);
    expect((await cli(["check", "--base", "main", "--quiet"], repo.dir)).code).toBe(0);
    for (const name of [
      "CANARY_SCRIPT",
      "CANARY_DEPCRUISE",
      "CANARY_WEBPACK",
      "CANARY_BABEL",
      "CANARY_GIT",
    ]) {
      expect(existsSync(join(repo.dir, name)), name).toBe(false);
      expect(existsSync(join(process.cwd(), name)), name).toBe(false);
    }
    // Positive control: the trap is armed — an ordinary git diff (without Impact Check' hardening) trips it.
    spawnSync("git", ["diff", "HEAD"], { cwd: repo.dir });
    expect(existsSync(join(repo.dir, "CANARY_GIT"))).toBe(true);
  });

  it("never copies file contents or values into reports", async () => {
    const marker = "do-not-leak-7f3a9c";
    const repo = Repo.create({
      ...basicTs,
      "src/keys.ts": `export const API_TOKEN = "${marker}-old";\n`,
      ".env": `TOKEN=${marker}\n`,
    }).branch("f");
    repo.write({
      "src/keys.ts": `export const API_TOKEN = "${marker}-new";\n`,
      ".env": `TOKEN=${marker}-2\n`,
    });
    repo.commit("rotate");
    const json = await cli(
      ["analyze", "--base", "main", "--head", "HEAD", "--format", "json", "--quiet"],
      repo.dir
    );
    const md = await cli(["analyze", "--base", "main", "--head", "HEAD", "--quiet"], repo.dir);
    for (const out of [json.stdout, md.stdout, json.stderr, md.stderr]) expect(out).not.toContain(marker);
    expect(json.stdout).toContain("const API_TOKEN"); // the name only
  });

  it("does not print environment variables", async () => {
    process.env["IMPACT_CHECK_TEST_SECRET"] = "env-secret-value-123";
    const repo = Repo.create(basicTs);
    const result = await cli(["analyze", "--base", "main"], repo.dir);
    expect(result.stdout + result.stderr).not.toContain("env-secret-value-123");
    delete process.env["IMPACT_CHECK_TEST_SECRET"];
  });
});
