// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
/**
 * `impact-check graph` (docs/GRAPH.md): fixture G1 against the hand-written test/expected/g1-graph.json, schema
 * validation, determinism, working-tree mode, `schema graph`, and usage errors for diff-only options.
 */
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { describe, expect, it } from "vitest";
import { cli, Repo } from "./helpers.js";

type Json = Record<string, unknown>;
const json = (o: unknown): string => `${JSON.stringify(o, null, 2)}\n`;

const g1: Record<string, string> = {
  "package.json": json({ name: "shop", private: true, workspaces: ["packages/*"] }),
  "tsconfig.json": json({ compilerOptions: { module: "nodenext", moduleResolution: "nodenext" } }),
  "packages/core/package.json": json({ name: "@shop/core", version: "1.0.0", main: "src/index.ts" }),
  "packages/core/src/index.ts": 'export { price } from "./price.js";\n',
  "packages/core/src/price.ts":
    'import type { Money } from "./money.js";\nexport const price = (m: Money): number => m.cents / 100;\n',
  "packages/core/src/money.ts": "export interface Money {\n  cents: number;\n}\n",
  "packages/web/package.json": json({
    name: "@shop/web",
    version: "1.0.0",
    dependencies: { "@shop/core": "1.0.0", react: "19.0.0" },
  }),
  "packages/web/src/app.ts": [
    'import { price } from "@shop/core";',
    'import { useState } from "react";',
    'import { missing } from "./missing.js";',
    'import { readFileSync } from "node:fs";',
    "export const show = (): string => String(price({ cents: 100 })) + String(useState) + String(missing) + String(readFileSync);",
    "",
  ].join("\n"),
  "packages/web/src/app.test.ts": 'import { show } from "./app.js";\nconsole.assert(show().length > 0);\n',
};

const graphSchema = JSON.parse(
  readFileSync(new URL("../schema/impact-check-graph.schema.json", import.meta.url), "utf8")
);
const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => void;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(graphSchema);

async function graph(repo: Repo, args: string[]): Promise<Json> {
  const r = await cli(["graph", "--quiet", ...args], repo.dir);
  expect(r.code, r.stderr).toBe(0);
  const out = JSON.parse(r.stdout) as Json;
  if (!validate(out)) throw new Error(JSON.stringify(validate.errors, null, 2));
  return out;
}

describe("impact-check graph (G1)", () => {
  it("matches the hand-written expected graph", async () => {
    const repo = Repo.create(g1);
    const head = repo.git("rev-parse", "HEAD");
    const out = await graph(repo, ["--format", "json", "--head", "HEAD"]);
    const expected = JSON.parse(
      readFileSync(new URL("./expected/g1-graph.json", import.meta.url), "utf8").replace("<head>", head)
    ) as Json;
    const { run_metadata: meta, ...rest } = out;
    expect(rest).toEqual(expected);
    expect(meta).toMatchObject({
      tool: "impact-check",
      engine: "dependency-cruiser",
      network: false,
      executed_repository_code: false,
      generated_at: "2026-01-01T00:00:00.000Z",
    });
  });

  it("is deterministic and defaults to the working tree", async () => {
    const repo = Repo.create(g1);
    const a = await graph(repo, ["--head", "HEAD"]);
    const b = await graph(repo, ["--head", "HEAD"]);
    expect(a).toEqual(b);
    repo.write({ "packages/web/src/extra.ts": 'import { show } from "./app.js";\nexport const x = show;\n' });
    const wt = await graph(repo, []);
    expect(wt["repo_revision"]).toMatchObject({ ref: "WORKTREE", kind: "worktree" });
    expect((wt["edges"] as Json[]).map((e) => e["from"])).toContain("packages/web/src/extra.ts");
  });

  it("writes to --output and prints its schema with `schema graph`", async () => {
    const repo = Repo.create(g1);
    const r = await cli(["graph", "--quiet", "--output", "graph.json"], repo.dir);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe("");
    expect(JSON.parse(readFileSync(`${repo.dir}/graph.json`, "utf8"))["schema_version"]).toBe("1.0");
    const s = await cli(["schema", "graph"], repo.dir);
    expect(s.code).toBe(0);
    expect(JSON.parse(s.stdout)["$id"]).toBe("urn:impact-check:graph:1.0");
    const report = await cli(["schema"], repo.dir);
    expect(JSON.parse(report.stdout)["$id"]).toBe("urn:impact-check:report:2.0");
  });

  it("rejects diff-only options and other formats as usage errors", async () => {
    const repo = Repo.create(g1);
    for (const args of [
      ["--base", "main"],
      ["--diff-mode", "direct"],
      ["--max-depth", "2"],
      ["--max-affected", "2"],
      ["--format", "markdown"],
      ["--head", "HEAD", "--worktree"],
    ]) {
      const r = await cli(["graph", ...args], repo.dir);
      expect(r.code, args.join(" ")).toBe(2);
    }
    expect((await cli(["schema", "nope"], repo.dir)).code).toBe(2);
  });
});
