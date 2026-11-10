import type { LineRange } from "../types.js";
/** One named export of a module as seen by the parser. */
export interface ExportInfo {
    name: string;
    kind: string;
    line: number;
    typeOnly: boolean;
    /** Line ranges that make up the declaration's public signature (bodies and private members excluded). */
    signature: LineRange[];
}
/** All statically visible exports of one module, plus markers that make the set incomplete. */
export interface ExportSet {
    exports: Map<string, ExportInfo>;
    /** Specifiers of `export * from "..."`: the export set is open and cannot be fully known statically. */
    starReexports: string[];
    /** CommonJS `module.exports` / `exports.x` / `export =` present (shapes not analyzed). */
    commonJs: boolean;
    parseErrors: number;
}
/** One name imported (or re-exported) from a module specifier. */
export interface ImportedName {
    specifier: string;
    /** Imported (not local) name; "default" for default imports; "*" for namespace imports. */
    name: string;
    line: number;
    typeOnly: boolean;
}
/**
 * Parses a module and returns its named exports with lines and signature ranges. Tolerates syntax errors
 * (the count is reported in `parseErrors`).
 */
export declare function extractExports(text: string, path: string): ExportSet;
/**
 * Lists the names a module imports or re-exports by name, per specifier. Namespace imports are reported as
 * name "*" and side-effect imports are omitted.
 */
export declare function importedNames(text: string, path: string): ImportedName[];
/** True when any line in `lines` falls inside any of the ranges. Returns the first such line. */
export declare function firstLineIn(ranges: readonly LineRange[], lines: readonly number[]): number | null;
