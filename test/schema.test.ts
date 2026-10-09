import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { describe, expect, it } from "vitest";
import { analyzeJson, cli, Repo } from "./helpers.js";
import { basicTs } from "./fixtures/basic-ts.js";
import { monorepo } from "./fixtures/monorepo.js";
import { normalizeReport } from "../src/report/json.js";

const schema = JSON.parse(
  readFileSync(new URL("../schema/changelens-report.schema.json", import.meta.url), "utf8")
);
const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => void;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

function assertValid(report: unknown): void {
  const ok = validate(report);
  if (!ok) throw new Error(JSON.stringify(validate.errors, null, 2));
}

describe("JSON schema (acceptance E) and determinism", () => {
  it("validates reports from several scenarios", async () => {
    const repo = Repo.create(basicTs).branch("feature");
    repo.remove("src/utils/format.ts");
    repo.write({
      "db/migrations/9.sql": "--\n",
      "src/auth/x.ts": "export const x = 1;\n",
      "img.bin": Buffer.from([0, 1, 2]),
    });
    repo.commit("a");
    assertValid(await analyzeJson(repo.dir, ["--base", "main", "--head", "HEAD"]));
    repo.write({ "untracked.ts": "export {};\n" });
    assertValid(await analyzeJson(repo.dir, ["--base", "main"]));
    assertValid(await analyzeJson(Repo.create(basicTs).dir, ["--base", "main", "--head", "HEAD"]));
    const mono = Repo.create(monorepo).branch("f");
    mono.write({ "packages/core/src/math.ts": "export const sum = 1;\n" });
    mono.commit("m");
    assertValid(await analyzeJson(mono.dir, ["--base", "main", "--head", "HEAD"]));
  });

  it("the schema command prints the same schema", async () => {
    const result = await cli(["schema"], process.cwd());
    expect(JSON.parse(result.stdout)).toEqual(schema);
  });

  it("produces byte-identical normalized JSON across runs and across commit/worktree modes", async () => {
    const repo = Repo.create(basicTs).branch("feature");
    repo.write({ "src/utils/format.ts": basicTs["src/utils/format.ts"] + "export const Z = 1;\n" });
    repo.remove("src/utils/unused.ts");
    repo.commit("c");
    const runs = await Promise.all(
      [1, 2, 3].map(() => analyzeJson(repo.dir, ["--base", "main", "--head", "HEAD"]))
    );
    const normalized = runs.map((r) => JSON.stringify(normalizeReport(r)));
    expect(new Set(normalized).size).toBe(1);
    const worktree = await analyzeJson(repo.dir, ["--base", "main"]);
    // Clean tree: only comparison metadata differs between modes.
    // Worktree-mode evidence has commit: null by design (content may be uncommitted); compare without commits.
    const noCommits = (v: unknown): unknown =>
      JSON.parse(JSON.stringify(v), (k, x) => (k === "commit" ? null : x));
    expect(noCommits(worktree.affected_modules)).toEqual(noCommits(runs[0]!.affected_modules));
    expect(noCommits(worktree.findings)).toEqual(noCommits(runs[0]!.findings));
    expect(worktree.test_candidates).toEqual(runs[0]!.test_candidates);
    // No absolute or temp paths leak.
    expect(normalized[0]).not.toContain(repo.dir);
    expect(normalized[0]).not.toContain("changelens-");
  });
});
