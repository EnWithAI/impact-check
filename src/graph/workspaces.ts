/**
 * Workspace package discovery (every package.json with a name) and convention-based mapping of
 * cross-package imports to source entry files. Edges created this way are labelled `inferred`.
 */
import type { Snapshot } from "../snapshot/snapshot.js";
import { compareStrings } from "../analysis/limitations.js";

/** A package found in the snapshot (any package.json with a name). */
export interface WorkspacePackage {
  name: string;
  /** Repo-relative directory ("" for the root package). */
  dir: string;
  manifest: Record<string, unknown>;
}

/** Parses JSON text and returns it only if it is a plain object; null otherwise (never throws). */
export function parseJsonObject(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Every package.json in the snapshot that declares a name is treated as a package. This covers npm/yarn/pnpm
 * workspaces without evaluating workspace globs (which may live in YAML we do not parse).
 */
export function findPackages(snapshot: Snapshot): WorkspacePackage[] {
  const packages: WorkspacePackage[] = [];
  for (const path of snapshot.files) {
    if (path !== "package.json" && !path.endsWith("/package.json")) continue;
    const manifest = parseJsonObject(snapshot.read(path));
    if (!manifest || typeof manifest["name"] !== "string" || manifest["name"].length === 0) continue;
    const dir = path === "package.json" ? "" : path.slice(0, -"/package.json".length);
    packages.push({ name: manifest["name"], dir, manifest });
  }
  return packages.sort((a, b) => compareStrings(a.dir, b.dir));
}

const ENTRY_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/** Joins a package directory and a manifest-relative path. */
function join(dir: string, rel: string): string {
  const clean = rel.replace(/^\.\//, "");
  return dir ? `${dir}/${clean}` : clean;
}

/** Collects every string value of a (possibly nested) manifest field such as `exports`. */
function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) collectStrings(v, out);
}

/** Manifest-declared entry targets (main/module/types/exports/source), repo-relative. */
export function manifestEntries(pkg: WorkspacePackage): string[] {
  const values: string[] = [];
  for (const field of ["source", "main", "module", "types", "typings", "browser"]) {
    const v = pkg.manifest[field];
    if (typeof v === "string") values.push(v);
  }
  collectStrings(pkg.manifest["exports"], values);
  return [...new Set(values.filter((v) => !v.includes("*")).map((v) => join(pkg.dir, v)))].sort(
    compareStrings
  );
}

/** Candidate source files for `<pkg>` or `<pkg>/<subpath>`, checked against the snapshot. */
export function resolveWorkspaceSpecifier(
  specifier: string,
  packages: WorkspacePackage[],
  exists: (path: string) => boolean
): { pkg: WorkspacePackage; target: string } | null {
  const pkg = packages
    .filter((p) => specifier === p.name || specifier.startsWith(`${p.name}/`))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (!pkg) return null;
  const subpath = specifier.slice(pkg.name.length).replace(/^\//, "");
  const bases = subpath
    ? [join(pkg.dir, `src/${subpath}`), join(pkg.dir, subpath)]
    : [...manifestEntries(pkg).map(stripExt), join(pkg.dir, "src/index"), join(pkg.dir, "index")];
  for (const base of bases) {
    for (const candidate of [
      base,
      ...ENTRY_EXTENSIONS.map((e) => base + e),
      ...ENTRY_EXTENSIONS.map((e) => `${base}/index${e}`),
    ]) {
      if (exists(candidate)) return { pkg, target: candidate };
    }
  }
  return null;
}

/** Removes a JS/TS (or .d.ts) extension so that dist entries can be mapped to sources. */
function stripExt(path: string): string {
  return path.replace(/\.(d\.ts|[cm]?[jt]sx?)$/, "");
}
