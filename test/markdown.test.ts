// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
/**
 * Markdown escaping, secret redaction and reporter caps (row limits, size limit, branding toggle).
 */
import { describe, expect, it } from "vitest";
import { code, text, visible } from "../src/report/escape.js";
import { redact, redactDeep, REDACTED } from "../src/report/redact.js";
import { renderMarkdown } from "../src/report/markdown.js";
import { analyzeJson, Repo } from "./helpers.js";
import { basicTs } from "./fixtures/basic-ts.js";

describe("escaping (acceptance F)", () => {
  it("code spans survive backticks, pipes and control characters", () => {
    expect(code("a`b")).toBe("``a`b``");
    expect(code("``x")).toBe("``` ``x ```");
    expect(code("a|b")).toBe("`a\\|b`");
    expect(code("line\nbreak‮")).toBe("`line\\nbreak\\u202e`");
    expect(code("x".repeat(400))).toHaveLength(303);
  });
  it("text escapes markdown, html, mentions and list markers", () => {
    expect(text("<script>")).toBe("\\<script\\>");
    expect(text("[x](javascript:1)")).toBe("\\[x\\](javascript:1)");
    expect(text("@octocat")).toBe("@​octocat");
    expect(text("# heading", { lineStart: true })).toBe("\\# heading");
    expect(text("1. item", { lineStart: true })).toBe("1\\. item");
    expect(text("0.1.0")).toBe("0.1.0");
    expect(text("a & b")).toBe("a &amp; b");
    expect(visible("\u0000\t")).toBe("\\u0000\\t");
  });
});

describe("redaction (T5)", () => {
  it("masks token-like strings", () => {
    for (const secret of [
      "ghp_" + "a".repeat(36),
      "github_pat_" + "A1_".repeat(10),
      "AKIA" + "ABCDEFGHIJKLMNOP",
      "sk-ant-" + "x".repeat(30),
      "xoxb-1234567890-abc",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      "https://user:hunter2@example.com",
    ]) {
      expect(redact(`src/${secret}.ts`)).toContain(REDACTED);
    }
    expect(redact("src/a".repeat(3))).not.toContain(REDACTED);
    expect(redactDeep({ sha: "a".repeat(40), path: "ghp_" + "b".repeat(36) }, new Set(["sha"]))).toEqual({
      sha: "a".repeat(40),
      path: REDACTED,
    });
  });

  it("redacts secrets embedded in changed file names in the report", async () => {
    const token = "ghp_" + "Z".repeat(36);
    const repo = Repo.create(basicTs).branch("f");
    repo.write({ [`config/${token}.json`]: "{}\n" });
    repo.commit("oops");
    const report = await analyzeJson(repo.dir, ["--base", "main", "--head", "HEAD"]);
    expect(JSON.stringify(report)).not.toContain(token);
    expect(report.changed_files[0]!.path).toBe(`config/${REDACTED}.json`);
  });
});

describe("markdown reporter", () => {
  it("shows limits/unknowns, legend, and respects row and size caps", async () => {
    const files: Record<string, string> = { ...basicTs };
    const repo = Repo.create(files).branch("f");
    const many: Record<string, string> = {};
    for (let i = 0; i < 30; i++) many[`docs/page-${String(i).padStart(2, "0")}.md`] = `${i}\n`;
    repo.write(many);
    repo.commit("docs");
    const report = await analyzeJson(repo.dir, ["--base", "main", "--head", "HEAD"]);
    const md = renderMarkdown(report, { branding: false, maxRows: 10 });
    expect(md).toContain("## Limitations and unknowns");
    expect(md).toContain("`tests-not-executed`");
    expect(md).toContain("…and 20 more files (see the JSON report)");
    expect(md).not.toContain("crewpe.ai");
    expect(renderMarkdown(report, { branding: true })).toContain("An EnWithAI Engineering Commons tool");
    const small = renderMarkdown(report, { branding: false, maxChars: 1500 });
    expect(small.length).toBeLessThanOrEqual(1500);
    expect(small).toContain("Report truncated");
  });
});
