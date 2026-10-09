// Written before src/analyzers/exports.ts (verification-first).
import { describe, expect, it } from "vitest";
import { extractExports, importedNames } from "../src/analyzers/exports.js";

describe("extractExports (TypeScript AST, no type checker)", () => {
  it("collects named exports of every declaration kind with lines", () => {
    const text = [
      "export function f(a: number) { return a; }", // 1
      "export const a = 1, b = 2;", // 2
      "export class C {}", // 3
      "export interface I { x: number }", // 4
      "export type T = string;", // 5
      "export enum E { A }", // 6
      "export namespace N { export const z = 1; }", // 7
      "export default function main() {}", // 8
      "const hidden = 1;", // 9
      "export { hidden as visible };", // 10
      'export { r } from "./r";', // 11
      'export * from "./star";', // 12
      'export * as ns from "./ns";', // 13
      "export type { I as J };", // 14
      "export declare const d: number;", // 15
    ].join("\n");
    const set = extractExports(text, "m.ts");
    expect([...set.exports.keys()].sort()).toEqual(
      ["C", "E", "I", "J", "N", "T", "a", "b", "d", "default", "f", "ns", "r", "visible"].sort()
    );
    expect(set.exports.get("f")).toMatchObject({ kind: "function", line: 1 });
    expect(set.exports.get("b")).toMatchObject({ kind: "const", line: 2 });
    expect(set.exports.get("default")).toMatchObject({ kind: "function", line: 8 });
    expect(set.exports.get("visible")).toMatchObject({ kind: "export-list", line: 10 });
    expect(set.exports.get("r")).toMatchObject({ kind: "re-export", line: 11 });
    expect(set.exports.get("ns")).toMatchObject({ kind: "re-export", line: 13 });
    expect(set.exports.get("J")).toMatchObject({ typeOnly: true });
    expect(set.exports.get("I")).toMatchObject({ typeOnly: true, kind: "interface" });
    expect(set.starReexports).toEqual(["./star"]);
    expect(set.commonJs).toBe(false);
    expect(set.parseErrors).toBe(0);
  });

  it("computes signature line ranges that exclude function bodies and private members", () => {
    const text = [
      "export function f(", // 1
      "  a: number,", // 2
      "  b: string", // 3
      "): void {", // 4
      "  console.log(a, b);", // 5 body
      "}", // 6
      "export const g = (x: number) => {", // 7
      "  return x;", // 8 body
      "};", // 9
      "export interface I {", // 10
      "  x: number;", // 11
      "}", // 12
      "export class K {", // 13
      "  private secret = 1;", // 14
      "  run(a: number): void {", // 15
      "    this.secret = a;", // 16 body
      "  }", // 17
      "}", // 18
      "export const VALUE = 5;", // 19
    ].join("\n");
    const set = extractExports(text, "s.ts");
    expect(set.exports.get("f")!.signature).toEqual([{ start: 1, end: 4 }]);
    expect(set.exports.get("g")!.signature).toEqual([{ start: 7, end: 7 }]);
    expect(set.exports.get("I")!.signature).toEqual([{ start: 10, end: 12 }]);
    expect(set.exports.get("K")!.signature).toEqual([
      { start: 13, end: 13 },
      { start: 15, end: 15 },
    ]);
    expect(set.exports.get("VALUE")!.signature).toEqual([{ start: 19, end: 19 }]);
  });

  it("flags CommonJS exports and tolerates syntax errors", () => {
    expect(extractExports("module.exports = { a: 1 };\nexports.b = 2;", "c.js").commonJs).toBe(true);
    const broken = extractExports("export const ok = 1;\nexport function (( {", "b.ts");
    expect(broken.exports.has("ok")).toBe(true);
    expect(broken.parseErrors).toBeGreaterThan(0);
  });
});

describe("importedNames", () => {
  it("lists named, default and type imports and named re-exports per specifier with lines", () => {
    const text = [
      'import d, { a, b as c, type T } from "./m";', // 1
      'import * as ns from "./m";', // 2
      'import "./side";', // 3
      'export { x as y } from "./m";', // 4
      'import type { Only } from "./types";', // 5
    ].join("\n");
    const names = importedNames(text, "u.ts");
    expect(names).toEqual([
      { specifier: "./m", name: "default", line: 1, typeOnly: false },
      { specifier: "./m", name: "a", line: 1, typeOnly: false },
      { specifier: "./m", name: "b", line: 1, typeOnly: false },
      { specifier: "./m", name: "T", line: 1, typeOnly: true },
      { specifier: "./m", name: "*", line: 2, typeOnly: false },
      { specifier: "./m", name: "x", line: 4, typeOnly: false },
      { specifier: "./types", name: "Only", line: 5, typeOnly: true },
    ]);
  });
});
