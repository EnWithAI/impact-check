import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { describe, expect, it } from "vitest";
import { Repo, cli } from "../helpers.js";
import { acceptanceRepo, FORMAT_TS } from "./fixtures.js";
import { normalize } from "./harness.js";

const schema = JSON.parse(
  readFileSync(new URL("../../schema/impact-check-report.schema.json", import.meta.url), "utf8")
);
const ajv = new Ajv2020({ allErrors: true, strict: true });
(addFormatsModule as unknown as (a: Ajv2020) => void)(ajv);
const validate = ajv.compile(schema);

async function run(repo: Repo, args: string[]): Promise<Record<string, unknown>> {
  const r = await cli(["analyze", "--format", "json", "--quiet", ...args], repo.dir);
  expect(r.code, r.stderr).toBe(0);
  const parsed = JSON.parse(r.stdout) as Record<string, unknown>;
  if (!validate(parsed)) throw new Error(JSON.stringify(validate.errors, null, 2));
  return parsed;
}

describe("A8 — stable schema and deterministic snapshots", () => {
  const build = (): Repo => {
    const repo = Repo.create(acceptanceRepo).branch("feature");
    repo.write({
      "src/utils/format.ts": FORMAT_TS.replace('\nexport const CURRENCY = "USD";\n', "\n"),
      "db/migrations/9.sql": "--\n",
    });
    repo.remove("src/utils/unused.ts");
    repo.commit("mixed");
    return repo;
  };

  it("validates against schema 2.0 and is identical across runs and fresh repositories", async () => {
    const a = build();
    const b = build(); // a separate repository with identical content and commit metadata
    const runs = [
      await run(a, ["--base", "main", "--head", "HEAD"]),
      await run(a, ["--base", "main", "--head", "HEAD"]),
      await run(b, ["--base", "main", "--head", "HEAD"]),
    ];
    const texts = runs.map((r) => JSON.stringify(normalize(r)));
    expect(new Set(texts).size).toBe(1);
    expect((runs[0]!["run_metadata"] as Record<string, unknown>)["duration_ms"]).toEqual(expect.any(Number));
  });

  it("matches the reviewed golden snapshot (regression lock for rule changes)", async () => {
    const r = await run(build(), ["--base", "main", "--head", "HEAD"]);
    await expect(JSON.stringify(normalize(r), null, 2) + "\n").toMatchFileSnapshot("./golden/a8-mixed.json");
  });
});
