// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
// Regenerates examples/demo/output/* from the reproducible demo repository using the built CLI.
// Usage: npm run build && node scripts/generate-demo-output.mjs
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Run-specific metadata is normalized so the committed samples are reproducible (see schema description).
function normalizeJson(text) {
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

const root = new URL("..", import.meta.url).pathname.replace(/%20/g, " ");
const work = mkdtempSync(join(tmpdir(), "impact-check-demo-"));
const demo = join(work, "impact-check-demo");
try {
  const create = spawnSync(process.execPath, [join(root, "examples/demo/create-demo.mjs"), demo], {
    encoding: "utf8",
  });
  if (create.status !== 0) throw new Error(create.stderr);
  const out = join(root, "examples/demo/output");
  mkdirSync(out, { recursive: true });
  for (const [format, file] of [
    ["markdown", "sample-report.md"],
    ["json", "sample-report.json"],
  ]) {
    const r = spawnSync(
      process.execPath,
      [
        join(root, "dist/cli/main.js"),
        "analyze",
        "--cwd",
        demo,
        "--base",
        "main",
        "--format",
        format,
        "--quiet",
      ],
      { encoding: "utf8" }
    );
    if (r.status !== 0) throw new Error(r.stderr);
    const text = format === "json" ? normalizeJson(r.stdout) : r.stdout;
    writeFileSync(join(out, file), text);
  }
  console.log(`Wrote ${out}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
