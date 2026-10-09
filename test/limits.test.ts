import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeJson, cli, dependents, limitationCodes, Repo } from "./helpers.js";
import { basicTs } from "./fixtures/basic-ts.js";

const head = ["--base", "main", "--head", "HEAD"];

describe("limits and safe degradation (T6)", () => {
  it("skips files over the size cap and reports them", async () => {
    const repo = Repo.create(basicTs).branch("f");
    repo.write({ "src/huge.ts": `export const big = "${"x".repeat(1024 * 1024 + 10)}";\n` });
    repo.commit("big");
    const report = await analyzeJson(repo.dir, head);
    expect(report.coverageLimitations.find((l) => l.code === "file-too-large")?.paths).toEqual([
      "src/huge.ts",
    ]);
  });

  it("truncates affected modules and depth with explicit limitations", async () => {
    const files: Record<string, string> = { ...basicTs, "src/root.ts": "export const r = 1;\n" };
    for (let i = 0; i < 8; i++)
      files[`src/fan/f${i}.ts`] = 'import { r } from "../root";\nexport const v = r;\n';
    files["src/chain/c0.ts"] = 'import { r } from "../root";\nexport const c = r;\n';
    for (let i = 1; i < 6; i++)
      files[`src/chain/c${i}.ts`] = `import { c } from "./c${i - 1}";\nexport { c };\n`;
    const repo = Repo.create(files).branch("f");
    repo.write({ "src/root.ts": "export const r = 2;\n" });
    repo.commit("root");
    const report = await analyzeJson(repo.dir, [...head, "--max-affected", "5", "--max-depth", "3"]);
    expect(dependents(report)).toHaveLength(5);
    expect(report.analysis.limits).toEqual({ maxDepth: 3, maxAffected: 5, truncated: true });
    expect(limitationCodes(report)).toEqual(
      expect.arrayContaining(["graph-truncated", "depth-limit-reached"])
    );
    const full = await analyzeJson(repo.dir, head);
    expect(dependents(full)).toContain("src/chain/c5.ts");
  });

  it("reports unsupported languages, component files and submodules", async () => {
    const sub = Repo.create({ "lib.ts": "export const s = 1;\n" });
    const repo = Repo.create(basicTs).branch("f");
    repo.write({ "scripts/tool.py": "print(1)\n", "src/App.vue": "<template></template>\n" });
    spawnSync("git", ["-c", "protocol.file.allow=always", "submodule", "add", "-q", sub.dir, "vendor/sub"], {
      cwd: repo.dir,
    });
    repo.commit("misc");
    const report = await analyzeJson(repo.dir, head);
    const codes = limitationCodes(report);
    expect(codes).toEqual(
      expect.arrayContaining(["unsupported-language", "unsupported-file-type", "submodule-skipped"])
    );
  });

  it("falls back when tsconfig extends an uninstalled package, keeping local paths", async () => {
    const tsconfig = {
      extends: "@tsconfig/node22/tsconfig.json",
      compilerOptions: { baseUrl: ".", paths: { "@utils/*": ["src/utils/*"] } },
    };
    const repo = Repo.create({ ...basicTs, "tsconfig.json": JSON.stringify(tsconfig) }).branch("f");
    repo.write({ "src/utils/format.ts": basicTs["src/utils/format.ts"] + "// x\n" });
    repo.commit("x");
    const report = await analyzeJson(repo.dir, head);
    expect(report.coverageLimitations.find((l) => l.code === "tsconfig-extends-unavailable")?.paths).toEqual([
      "tsconfig.json → @tsconfig/node22/tsconfig.json",
    ]);
    expect(dependents(report)).toContain("src/services/cart.ts"); // alias still resolved
  });

  it("reports unreadable tsconfig and extra tsconfig paths", async () => {
    const repo = Repo.create({
      ...basicTs,
      "tsconfig.json": "{ this is not json",
      "packages/x/tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "#x/*": ["./*"] } } }),
    }).branch("f");
    repo.write({ "src/utils/unused.ts": "export const unused = 3;\n" });
    repo.commit("x");
    const report = await analyzeJson(repo.dir, head);
    expect(limitationCodes(report)).toEqual(
      expect.arrayContaining(["tsconfig-unreadable", "additional-tsconfig-paths-ignored"])
    );
    expect(report.repository.tsConfig).toBeNull();
    const missing = await analyzeJson(repo.dir, [...head, "--tsconfig", "nope.json"]);
    expect(limitationCodes(missing)).toContain("tsconfig-not-found");
  });

  it("lists conflicted paths as unmerged with a limitation", async () => {
    const repo = Repo.create(basicTs);
    repo.branch("a");
    repo.write({ "src/utils/unused.ts": "export const unused = 'a';\n" });
    repo.commit("a");
    repo.git("checkout", "-q", "main");
    repo.write({ "src/utils/unused.ts": "export const unused = 'main';\n" });
    repo.commit("m");
    spawnSync("git", ["merge", "a"], { cwd: repo.dir });
    const report = await analyzeJson(repo.dir, ["--base", "main"]);
    expect(report.filesChanged.find((f) => f.path === "src/utils/unused.ts")?.status).toBe("unmerged");
    expect(limitationCodes(report)).toContain("unmerged-paths");
  });

  it("skips untracked node_modules that are not ignored", async () => {
    const repo = Repo.create(basicTs);
    mkdirSync(join(repo.dir, "node_modules/pkg"), { recursive: true });
    writeFileSync(join(repo.dir, "node_modules/pkg/index.js"), "module.exports = 1;\n");
    const report = await analyzeJson(repo.dir, ["--base", "main"]);
    expect(report.filesChanged).toEqual([]);
    expect(report.coverageLimitations.find((l) => l.code === "untracked-node-modules-skipped")?.count).toBe(
      1
    );
  });

  it("analyzes a ~2000-module repository within a reasonable time", async () => {
    const files: Record<string, string> = {
      "package.json": '{"name":"big"}',
      "src/core.ts": "export const core = 1;\n",
    };
    for (let i = 0; i < 2000; i++) {
      files[`src/m${i}.ts`] =
        i < 50
          ? 'import { core } from "./core";\nexport const v = core;\n'
          : `import { v } from "./m${i % 50}";\nexport const w${i} = v;\n`;
    }
    const repo = Repo.create(files).branch("f");
    repo.write({ "src/core.ts": "export const core = 2;\n" });
    repo.commit("core");
    const start = Date.now();
    const result = await cli(
      ["analyze", ...head, "--format", "json", "--quiet", "--max-affected", "5000"],
      repo.dir
    );
    const elapsed = Date.now() - start;
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).summary.affectedModules).toBe(2001);
    expect(elapsed).toBeLessThan(60_000);
    console.log(`2000-module analysis took ${elapsed} ms`);
  });
});
