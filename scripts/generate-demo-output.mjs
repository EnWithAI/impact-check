// Regenerates examples/demo/output/* from the reproducible demo repository using the built CLI.
// Usage: npm run build && node scripts/generate-demo-output.mjs
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/%20/g, " ");
const work = mkdtempSync(join(tmpdir(), "changelens-demo-"));
const demo = join(work, "changelens-demo");
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
    const text =
      format === "json"
        ? r.stdout.replace(/"generatedAt": "[^"]+"/, '"generatedAt": "2026-01-01T00:00:00.000Z"')
        : r.stdout;
    writeFileSync(join(out, file), text);
  }
  console.log(`Wrote ${out}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
