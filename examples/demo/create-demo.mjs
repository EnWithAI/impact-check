#!/usr/bin/env node
// Creates a small synthetic TypeScript repository with a feature branch, for trying ChangeLens.
// Usage: node examples/demo/create-demo.mjs <empty-target-dir>
// Uses only git and the filesystem; installs nothing and runs no package scripts.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const target = resolve(process.argv[2] ?? "changelens-demo");
if (existsSync(target) && readdirSync(target).length > 0) {
  console.error(`Target ${target} exists and is not empty.`);
  process.exit(2);
}
mkdirSync(target, { recursive: true });

// Fixed identities and dates make the demo commits (and therefore the sample report) byte-reproducible.
const env = {
  ...process.env,
  GIT_AUTHOR_NAME: "ChangeLens Demo",
  GIT_AUTHOR_EMAIL: "demo@example.invalid",
  GIT_COMMITTER_NAME: "ChangeLens Demo",
  GIT_COMMITTER_EMAIL: "demo@example.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00+0000",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00+0000",
};
const git = (...args) => {
  const config = [
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.autocrlf=false",
  ];
  const r = spawnSync("git", [...config, ...args], { cwd: target, encoding: "utf8", env });
  if (r.status !== 0) {
    console.error(r.stderr);
    process.exit(1);
  }
};
const write = (files) => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(target, path)), { recursive: true });
    writeFileSync(join(target, path), content);
  }
};

write({
  "package.json":
    JSON.stringify({ name: "shop-demo", version: "1.0.0", type: "module", main: "src/index.ts" }, null, 2) +
    "\n",
  "tsconfig.json":
    JSON.stringify(
      {
        compilerOptions: {
          module: "esnext",
          moduleResolution: "bundler",
          strict: true,
          baseUrl: ".",
          paths: { "@lib/*": ["src/lib/*"] },
        },
      },
      null,
      2
    ) + "\n",
  "src/lib/money.ts":
    "export function formatCents(cents: number): string {\n  return (cents / 100).toFixed(2);\n}\n",
  "src/lib/legacy-tax.ts": "export const TAX_RATE = 0.2;\n",
  "src/cart/cart.ts":
    'import { formatCents } from "@lib/money";\nimport { TAX_RATE } from "../lib/legacy-tax";\n\nexport function cartTotal(prices: number[]): string {\n  const sum = prices.reduce((a, b) => a + b, 0);\n  return formatCents(Math.round(sum * (1 + TAX_RATE)));\n}\n',
  "src/checkout/checkout.ts":
    'import { cartTotal } from "../cart/cart";\n\nexport function checkout(prices: number[]): string {\n  return `Total: ${cartTotal(prices)}`;\n}\n',
  "src/index.ts": 'export * from "./checkout/checkout";\n',
  "src/auth/session.ts":
    'import { createHmac } from "node:crypto";\n\nexport const sign = (v: string, key: string) => createHmac("sha256", key).update(v).digest("hex");\n',
  "src/cart/cart.test.ts":
    'import { cartTotal } from "./cart";\nconsole.assert(cartTotal([100]) === "1.20");\n',
  "test/checkout.test.ts":
    'import { checkout } from "../src/checkout/checkout";\nconsole.assert(checkout([]).startsWith("Total"));\n',
  "README.md": "# shop-demo (synthetic)\n",
});
git("init", "-q", "-b", "main");
git("add", "-A");
git("commit", "-q", "-m", "Initial demo shop");

git("checkout", "-q", "-b", "feature/rounding");
write({
  "src/lib/money.ts":
    'export function formatCents(cents: number, currency = "USD"): string {\n  return `${currency} ${(cents / 100).toFixed(2)}`;\n}\n',
  "db/migrations/002_add_currency.sql": "ALTER TABLE orders ADD COLUMN currency TEXT;\n",
  "src/auth/session.ts":
    'import { createHmac } from "node:crypto";\n\nexport const sign = (v: string, key: string) => createHmac("sha512", key).update(v).digest("hex");\n',
});
rmSync(join(target, "src/lib/legacy-tax.ts"));
git("add", "-A");
git("commit", "-q", "-m", "Add currency to formatted prices; drop legacy tax module");
console.log(`Demo repository created at ${target} (branch feature/rounding vs main).`);
