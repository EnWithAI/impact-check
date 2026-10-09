import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tempDir } from "./helpers.js";

/** Same normalization as scripts/generate-demo-output.mjs (run-specific metadata only). */
function normalizeJson(text: string): string {
  const report = JSON.parse(text);
  report.run_metadata = {
    ...report.run_metadata,
    generated_at: "2026-01-01T00:00:00.000Z",
    duration_ms: 0,
    timings_ms: {},
    node_version: "normalized",
  };
  return `${JSON.stringify(report, null, 2)}\n`;
}

const root = fileURLToPath(new URL("..", import.meta.url));
const bin = join(root, "dist/cli/main.js");

// README quickstart (acceptance I): runs the *built* CLI as a separate process against a fresh demo repo.
describe.runIf(existsSync(bin))("README quickstart with the built CLI", () => {
  it("creates the demo repo and produces the documented report", () => {
    const demo = join(tempDir(), "changelens-demo");
    const create = spawnSync(process.execPath, [join(root, "examples/demo/create-demo.mjs"), demo], {
      encoding: "utf8",
    });
    expect(create.status, create.stderr).toBe(0);

    const md = spawnSync(process.execPath, [bin, "analyze", "--cwd", demo, "--base", "main"], {
      encoding: "utf8",
      env: { PATH: process.env["PATH"] ?? "" },
    });
    expect(md.status, md.stderr).toBe(0);
    expect(md.stdout).toContain("# ChangeLens impact report");
    expect(md.stdout).toContain(
      "HIGH · Import of deleted module no longer resolves: `src/lib/legacy-tax.ts`"
    );

    const json = spawnSync(
      process.execPath,
      [bin, "analyze", "--cwd", demo, "--base", "main", "--format", "json", "--quiet"],
      { encoding: "utf8" }
    );
    const report = JSON.parse(json.stdout);
    expect(report.affected_modules.map((m: { path: string }) => m.path)).toEqual([
      "src/auth/session.ts",
      "src/lib/legacy-tax.ts",
      "src/lib/money.ts",
      "src/cart/cart.ts",
      "src/cart/cart.test.ts",
      "src/checkout/checkout.ts",
      "src/index.ts",
      "test/checkout.test.ts",
    ]);
    // Expected vs actual: the committed sample outputs are reproduced byte-for-byte (except run metadata).
    const expectedJson = readFileSync(join(root, "examples/demo/output/sample-report.json"), "utf8");
    expect(normalizeJson(json.stdout)).toBe(expectedJson);
    expect(md.stdout).toBe(readFileSync(join(root, "examples/demo/output/sample-report.md"), "utf8"));
    const session = report.findings.find(
      (f: { rule_id: string }) => f.rule_id === "security-sensitive-change"
    );
    expect(session.evidence[1]).toMatchObject({ detail: 'imports "node:crypto"', line_start: 1 });

    const check = spawnSync(process.execPath, [bin, "check", "--cwd", demo, "--base", "main", "--quiet"], {
      encoding: "utf8",
    });
    expect(check.status).toBe(4);
  });
});

describe.skipIf(existsSync(bin))("README quickstart", () => {
  it.skip("requires `npm run build` first (dist/cli/main.js missing)", () => undefined);
});
