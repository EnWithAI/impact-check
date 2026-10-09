// Synthetic single-package TypeScript repository (no real or client code).
export const basicTs: Record<string, string> = {
  "package.json": JSON.stringify(
    {
      name: "basic-fixture",
      version: "1.0.0",
      type: "module",
      main: "src/index.ts",
      scripts: { test: "vitest" },
    },
    null,
    2
  ),
  "tsconfig.json": JSON.stringify(
    {
      compilerOptions: {
        module: "esnext",
        moduleResolution: "bundler",
        baseUrl: ".",
        paths: { "@utils/*": ["src/utils/*"] },
      },
    },
    null,
    2
  ),
  "README.md": "# Basic fixture\n",
  "src/utils/format.ts":
    'export function formatPrice(cents: number): string {\n  return `$${(cents / 100).toFixed(2)}`;\n}\n\nexport const CURRENCY = "USD";\n',
  "src/utils/unused.ts": "export const unused = 42;\n",
  "src/utils/format.test.ts":
    'import { formatPrice } from "./format";\nconsole.assert(formatPrice(100) === "$1.00");\n',
  "src/services/cart.ts":
    'import { formatPrice } from "@utils/format";\n\nexport interface Item {\n  cents: number;\n}\n\nexport function total(items: Item[]): string {\n  return formatPrice(items.reduce((s, i) => s + i.cents, 0));\n}\n',
  "src/services/checkout.ts":
    'import { total, type Item } from "./cart.js";\n\nexport function checkout(items: Item[]): string {\n  return total(items);\n}\n',
  "src/index.ts": 'export * from "./services/checkout";\n',
  "src/plugins/loader.ts":
    "export async function load(name: string) {\n  return import(`./plugins/${name}`);\n}\n",
  "src/legacy/missing.ts": 'import { gone } from "./does-not-exist";\nexport const legacy = gone;\n',
  "src/auth/session.ts":
    'import jwt from "jsonwebtoken";\nexport const verify = (t: string) => jwt.decode(t);\n',
  "test/cart.test.ts":
    'import { total } from "../src/services/cart";\nconsole.assert(total([]) === "$0.00");\n',
  "db/migrations/001_init.sql": "CREATE TABLE items (id INT);\n",
};
