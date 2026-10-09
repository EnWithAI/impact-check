import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runAction, type Env } from "../../src/action/run.js";
import { Repo, cli, tempDir } from "../helpers.js";
import { acceptanceRepo } from "./fixtures.js";

const SECRET_KEYS = ["GITHUB_TOKEN", "ACTIONS_RUNTIME_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL", "NPM_TOKEN"];

function env(repo: Repo, event: object, inputs: Record<string, string> = {}): { env: Env; accessed: Set<string>; output: string } {
  const dir = tempDir();
  writeFileSync(join(dir, "event.json"), JSON.stringify(event));
  const output = join(dir, "out.txt");
  writeFileSync(output, "");
  const base: Env = { GITHUB_WORKSPACE: repo.dir, GITHUB_EVENT_PATH: join(dir, "event.json"), GITHUB_OUTPUT: output };
  for (const [k, v] of Object.entries(inputs)) base[`INPUT_${k.toUpperCase().replace(/-/g, "_")}`] = v;
  for (const k of SECRET_KEYS) base[k] = `secret-${k}`;
  const accessed = new Set<string>();
  const proxy = new Proxy(base, { get: (t, k: string) => (accessed.add(k), t[k]), has: (t, k: string) => (accessed.add(k), k in t) });
  return { env: proxy, accessed, output };
}

describe("A7 — fork PR / minimal permissions", () => {
  it("analyzes a fork PR without ever reading any token or secret", async () => {
    const repo = Repo.create(acceptanceRepo);
    const baseSha = repo.git("rev-parse", "HEAD");
    repo.branch("fork-feature");
    repo.write({ "src/utils/unused.ts": "export const unused = 2;\n" });
    repo.commit("fork change");
    const fork = { pull_request: { base: { sha: baseSha }, head: { repo: { fork: true, full_name: "someone/fork" } } } };
    const run = env(repo, fork);
    const logs: string[] = [];
    expect(await runAction(run.env, (l) => logs.push(l))).toBe(0);
    for (const k of SECRET_KEYS) expect(run.accessed.has(k), k).toBe(false);
    expect(readFileSync(run.output, "utf8")).toContain("policy=passed");
    expect(logs.join("\n")).not.toContain("secret-");
  });

  it("fail-open vs fail-closed is explicit per check type (on-error)", async () => {
    const repo = Repo.create(acceptanceRepo);
    const badEvent = { pull_request: { base: { sha: "0".repeat(40) } } }; // base commit does not exist → tool error
    const cases: [Record<string, string>, number][] = [
      [{}, 0], // informational report (fail-on-policy false) → auto = warn (fail-open)
      [{ "fail-on-policy": "true" }, 3], // blocking policy → auto = fail (fail-closed)
      [{ "fail-on-policy": "true", "on-error": "warn" }, 0],
      [{ "on-error": "fail" }, 3],
    ];
    for (const [inputs, code] of cases) {
      const logs: string[] = [];
      expect(await runAction(env(repo, badEvent, inputs).env, (l) => logs.push(l)), JSON.stringify(inputs)).toBe(code);
      expect(logs.join("\n")).toMatch(code === 0 ? /::warning title=ChangeLens::/ : /::error title=ChangeLens::/);
    }
    const bad = await runAction(env(repo, badEvent, { "on-error": "maybe" }).env, () => undefined);
    expect(bad).toBe(2);
  });

  it("CLI check supports --on-error pass|fail with documented exit codes", async () => {
    const repo = Repo.create(acceptanceRepo);
    expect((await cli(["check", "--base", "nope", "--quiet"], repo.dir)).code).toBe(3);
    const open = await cli(["check", "--base", "nope", "--quiet", "--on-error", "pass"], repo.dir);
    expect(open.code).toBe(0);
    expect(open.stderr).toContain("on-error=pass");
    expect((await cli(["analyze", "--on-error", "sideways", "--quiet"], repo.dir)).code).toBe(2);
  });
});
