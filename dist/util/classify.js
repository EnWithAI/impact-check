const TS_EXT = [".ts", ".tsx", ".mts", ".cts"];
const JS_EXT = [".js", ".jsx", ".mjs", ".cjs"];
/** Extensions of JavaScript/TypeScript modules that are parsed. */
export const SOURCE_EXTENSIONS = [...TS_EXT, ...JS_EXT];
/** File types that may contain JS/TS modules but are not parsed in alpha. */
const UNSUPPORTED_MODULE_EXT = [".vue", ".svelte", ".astro", ".coffee", ".ls"];
/** Lower-case extension of a path, including the dot ("" when none). */
export function extname(path) {
    const base = path.slice(path.lastIndexOf("/") + 1);
    const dot = base.lastIndexOf(".");
    return dot > 0 ? base.slice(dot).toLowerCase() : "";
}
/** Last path segment of a repository-relative path. */
export function basenameOf(path) {
    return path.slice(path.lastIndexOf("/") + 1);
}
/** True for JavaScript/TypeScript module files. */
export function isJsTs(path) {
    return SOURCE_EXTENSIONS.includes(extname(path));
}
/** True for component formats that contain modules but are not parsed (.vue, .svelte, .astro, …). */
export function isUnsupportedModule(path) {
    return UNSUPPORTED_MODULE_EXT.includes(extname(path));
}
/** Language of a file by extension. */
export function languageOf(path) {
    const ext = extname(path);
    if (TS_EXT.includes(ext))
        return "typescript";
    if (JS_EXT.includes(ext))
        return "javascript";
    if (ext === ".json" || ext === ".jsonc")
        return "json";
    return "other";
}
const TEST_FILE = /\.(test|spec|e2e|it)\.[cm]?[jt]sx?$/i;
const TEST_DIR = /(^|\/)(__tests__|__test__|test|tests|spec|specs|e2e|cypress|playwright)\//i;
/** True for JS/TS files that look like tests (test/spec file names or test directories). */
export function isTestPath(path) {
    if (!isJsTs(path))
        return false;
    return TEST_FILE.test(path) || TEST_DIR.test(path);
}
const CONFIG_PATTERNS = [
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
/** True for build, tooling, CI, container, environment and workspace configuration files. */
export function isConfigPath(path) {
    return CONFIG_PATTERNS.some((re) => re.test(path));
}
/** Kind of a file by path convention: test, config, source or other. */
export function kindOf(path) {
    if (isTestPath(path))
        return "test";
    if (isConfigPath(path))
        return "config";
    if (isJsTs(path))
        return "source";
    return "other";
}
/** Files materialized into analysis snapshots: JS/TS modules plus resolution metadata. */
export function isSnapshotFile(path) {
    if (isJsTs(path))
        return true;
    const base = basenameOf(path);
    return base === "package.json" || /^(ts|js)config(\.[^/]*)?\.json$/.test(base);
}
/** Directories never materialized or analyzed. */
export function isIgnoredDir(path) {
    return /(^|\/)(node_modules|\.git)\//.test(path);
}
/** Path-safety check for repo-relative paths coming from git. */
export function isSafeRelativePath(path) {
    if (path.length === 0 || path.length > 4096)
        return false;
    if (path.includes("\0"))
        return false;
    if (process.platform === "win32" && path.includes("\\"))
        return false;
    if (path.startsWith("/") || /^[A-Za-z]:/.test(path))
        return false;
    return !path.split("/").some((segment) => segment === ".." || segment === "." || segment === "");
}
