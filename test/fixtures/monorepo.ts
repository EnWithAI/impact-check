// Synthetic npm-workspaces monorepo.
export const monorepo: Record<string, string> = {
  "package.json": JSON.stringify(
    { name: "acme-monorepo", private: true, workspaces: ["packages/*"] },
    null,
    2
  ),
  "tsconfig.json": JSON.stringify(
    { compilerOptions: { module: "nodenext", moduleResolution: "nodenext" } },
    null,
    2
  ),
  "packages/core/package.json": JSON.stringify(
    { name: "@acme/core", version: "1.0.0", main: "dist/index.js", types: "dist/index.d.ts" },
    null,
    2
  ),
  "packages/core/src/index.ts": 'export * from "./math.js";\n',
  "packages/core/src/math.ts": "export function sum(a: number, b: number): number {\n  return a + b;\n}\n",
  "packages/core/src/math.test.ts": 'import { sum } from "./math.js";\nconsole.assert(sum(1, 1) === 2);\n',
  "packages/app/package.json": JSON.stringify(
    { name: "@acme/app", version: "1.0.0", dependencies: { "@acme/core": "1.0.0" } },
    null,
    2
  ),
  "packages/app/src/main.ts": 'import { sum } from "@acme/core";\nexport const answer = sum(40, 2);\n',
  "packages/app/src/main.test.ts": 'import { answer } from "./main.js";\nconsole.assert(answer === 42);\n',
};
