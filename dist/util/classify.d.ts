/**
 * File classification helpers: language, kind (source/test/config/other), analyzable snapshot files,
 * ignored directories and repository-relative path safety checks.
 */
import type { FileKind, Language } from "../types.js";
/** Extensions of JavaScript/TypeScript modules that are parsed. */
export declare const SOURCE_EXTENSIONS: string[];
/** Lower-case extension of a path, including the dot ("" when none). */
export declare function extname(path: string): string;
/** Last path segment of a repository-relative path. */
export declare function basenameOf(path: string): string;
/** True for JavaScript/TypeScript module files. */
export declare function isJsTs(path: string): boolean;
/** True for component formats that contain modules but are not parsed (.vue, .svelte, .astro, …). */
export declare function isUnsupportedModule(path: string): boolean;
/** Language of a file by extension. */
export declare function languageOf(path: string): Language;
/** True for JS/TS files that look like tests (test/spec file names or test directories). */
export declare function isTestPath(path: string): boolean;
/** True for build, tooling, CI, container, environment and workspace configuration files. */
export declare function isConfigPath(path: string): boolean;
/** Kind of a file by path convention: test, config, source or other. */
export declare function kindOf(path: string): FileKind;
/** Files materialized into analysis snapshots: JS/TS modules plus resolution metadata. */
export declare function isSnapshotFile(path: string): boolean;
/** Directories never materialized or analyzed. */
export declare function isIgnoredDir(path: string): boolean;
/** Path-safety check for repo-relative paths coming from git. */
export declare function isSafeRelativePath(path: string): boolean;
