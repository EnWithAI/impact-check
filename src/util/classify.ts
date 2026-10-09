import type { FileKind, Language } from "../types.js";

const TS_EXT = [".ts", ".tsx", ".mts", ".cts"];
const JS_EXT = [".js", ".jsx", ".mjs", ".cjs"];
export const SOURCE_EXTENSIONS = [...TS_EXT, ...JS_EXT];
/** File types that may contain JS/TS modules but are not parsed in alpha. */
const UNSUPPORTED_MODULE_EXT = [".vue", ".svelte", ".astro", ".coffee", ".ls"];

export function extname(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

export function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function isJsTs(path: string): boolean {
  return SOURCE_EXTENSIONS.includes(extname(path));
}

export function isUnsupportedModule(path: string): boolean {
  return UNSUPPORTED_MODULE_EXT.includes(extname(path));
}

export function languageOf(path: string): Language {
  const ext = extname(path);
  if (TS_EXT.includes(ext)) return "typescript";
  if (JS_EXT.includes(ext)) return "javascript";
  if (ext === ".json" || ext === ".jsonc") return "json";
  return "other";
}

const TEST_FILE = /\.(test|spec|e2e|it)\.[cm]?[jt]sx?$/i;
const TEST_DIR = /(^|\/)(__tests__|__test__|test|tests|spec|specs|e2e|cypress|playwright)\//i;

export function isTestPath(path: string): boolean {
  if (!isJsTs(path)) return false;
  return TEST_FILE.test(path) || TEST_DIR.test(path);
}

const CONFIG_PATTERNS: RegExp[] = [
  /(^|\/)package\.json$/,
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/,
  /(^|\/)(ts|js)config(\.[^/]*)?\.json$/,
  /(^|\/)[^/]+\.config\.[cm]?[jt]s$/,
  /(^|\/)\.[^/]*rc(\.(json|js|cjs|mjs|ya?ml))?$/,
  /(^|\/)(Dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/,
  /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/,
  /(^|\/)\.env(\.[^/]*)?$/,
  /(^|\/)(pnpm-workspace\.yaml|lerna\.json|nx\.json|turbo\.json)$/,
];

export function isConfigPath(path: string): boolean {
  return CONFIG_PATTERNS.some((re) => re.test(path));
}

export function kindOf(path: string): FileKind {
  if (isTestPath(path)) return "test";
  if (isConfigPath(path)) return "config";
  if (isJsTs(path)) return "source";
  return "other";
}

/** Files materialized into analysis snapshots: JS/TS modules plus resolution metadata. */
export function isSnapshotFile(path: string): boolean {
  if (isJsTs(path)) return true;
  const base = basenameOf(path);
  return base === "package.json" || /^(ts|js)config(\.[^/]*)?\.json$/.test(base);
}

/** Directories never materialized or analyzed. */
export function isIgnoredDir(path: string): boolean {
  return /(^|\/)(node_modules|\.git)\//.test(path);
}

/** Path-safety check for repo-relative paths coming from git. */
export function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.length > 4096) return false;
  if (path.includes("\0")) return false;
  if (process.platform === "win32" && path.includes("\\")) return false;
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return false;
  return !path.split("/").some((segment) => segment === ".." || segment === "." || segment === "");
}
