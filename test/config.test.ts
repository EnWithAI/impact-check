// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
/**
 * Configuration validation (accepted and rejected shapes) and glob matching without regex injection.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, globToRegExp, matchesAny, parseConfigText } from "../src/config.js";
import { ImpactCheckError } from "../src/errors.js";

describe("config validation", () => {
  it("accepts a full valid config", () => {
    const config = parseConfigText(
      JSON.stringify({
        $schema: "x",
        base: "develop",
        tsconfig: "tsconfig.base.json",
        maxDepth: 3,
        maxAffected: 10,
        blastRadiusThreshold: 5,
        ignorePaths: ["a/**"],
        securityPathPatterns: ["b/*"],
        branding: false,
        policy: { failOnSeverity: "low", failOnRules: ["x"], maxAffectedModules: null },
      }),
      "t"
    );
    expect(config).toMatchObject({
      base: "develop",
      maxDepth: 3,
      branding: false,
      policy: { failOnSeverity: "low" },
    });
    expect(DEFAULT_CONFIG.policy.failOnSeverity).toBe("high");
  });
  it.each([
    ["not json", "{"],
    ["array", "[]"],
    ["unknown key", '{"script":"rm -rf /"}'],
    ["bad depth", '{"maxDepth":0}'],
    ["bad severity", '{"policy":{"failOnSeverity":"critical"}}'],
    ["unknown policy key", '{"policy":{"exec":"x"}}'],
    ["bad list", '{"ignorePaths":[1]}'],
    ["bad branding", '{"branding":"no"}'],
    ["bad base", '{"base":""}'],
    ["policy not object", '{"policy":1}'],
    ["huge", JSON.stringify({ ignorePaths: ["x".repeat(300_000)] })],
  ])("rejects %s with a usage error", (_name, text) => {
    expect(() => parseConfigText(text, "t")).toThrow(ImpactCheckError);
  });
  it("matches simple globs without regex injection", () => {
    expect(matchesAny("src/a/b.ts", ["src/**"])).toBe(true);
    expect(matchesAny("src/a/b.ts", ["src/*.ts"])).toBe(false);
    expect(matchesAny("src/b.ts", ["src/?.ts"])).toBe(true);
    expect(matchesAny("x/gen/y.ts", ["**/gen/**"])).toBe(true);
    expect(globToRegExp("(a|b)+$").test("(a|b)+$")).toBe(true);
    expect(globToRegExp("(a|b)+$").test("a")).toBe(false);
  });
});
