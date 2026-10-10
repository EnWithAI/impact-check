// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
// Lists licenses of all installed runtime (production) dependencies and fails on non-allowlisted licenses.
// Usage: node scripts/license-audit.mjs [--all]   (--all includes dev dependencies)
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = new Set([
  "MIT",
  "ISC",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "Python-2.0",
  "CC-BY-4.0",
]);
const all = process.argv.includes("--all");
const ls = spawnSync("npm", ["ls", "--all", "--json", ...(all ? [] : ["--omit=dev"])], {
  encoding: "utf8",
  shell: false,
});
const tree = JSON.parse(ls.stdout);
const seen = new Map();
const walk = (deps) => {
  for (const [name, info] of Object.entries(deps ?? {})) {
    const key = `${name}@${info.version}`;
    if (seen.has(key) || !info.version) continue;
    let license = "UNKNOWN";
    try {
      const pkg = JSON.parse(readFileSync(join("node_modules", name, "package.json"), "utf8"));
      license = typeof pkg.license === "string" ? pkg.license : (pkg.license?.type ?? "UNKNOWN");
    } catch {
      /* nested copy; fall back to UNKNOWN */
    }
    seen.set(key, license);
    walk(info.dependencies);
  }
};
walk(tree.dependencies);
const rows = [...seen.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
const counts = {};
let bad = 0;
for (const [pkg, license] of rows) {
  counts[license] = (counts[license] ?? 0) + 1;
  const ok = license.split(/\s+OR\s+|[()]/).some((l) => ALLOWED.has(l.trim()));
  if (!ok) bad++;
  console.log(`${ok ? "ok " : "BAD"} ${license.padEnd(14)} ${pkg}`);
}
console.log(
  `\n${rows.length} packages (${all ? "all" : "production"}); licenses: ${JSON.stringify(counts)}; disallowed: ${bad}`
);
process.exitCode = bad > 0 ? 1 : 0;
