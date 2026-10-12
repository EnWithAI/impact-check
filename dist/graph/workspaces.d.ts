/**
 * Workspace package discovery (every package.json with a name) and convention-based mapping of
 * cross-package imports to source entry files. Edges created this way are labelled `inferred`.
 */
import type { Snapshot } from "../snapshot/snapshot.js";
/** A package found in the snapshot (any package.json with a name). */
export interface WorkspacePackage {
    name: string;
    /** Repo-relative directory ("" for the root package). */
    dir: string;
    manifest: Record<string, unknown>;
}
/** Parses JSON text and returns it only if it is a plain object; null otherwise (never throws). */
export declare function parseJsonObject(text: string | null): Record<string, unknown> | null;
/**
 * Every package.json in the snapshot that declares a name is treated as a package. This covers npm/yarn/pnpm
 * workspaces without evaluating workspace globs (which may live in YAML we do not parse).
 */
export declare function findPackages(snapshot: Snapshot): WorkspacePackage[];
/** Manifest-declared entry targets (main/module/types/exports/source), repo-relative. */
export declare function manifestEntries(pkg: WorkspacePackage): string[];
/** Candidate source files for `<pkg>` or `<pkg>/<subpath>`, checked against the snapshot. */
export declare function resolveWorkspaceSpecifier(specifier: string, packages: WorkspacePackage[], exists: (path: string) => boolean): {
    pkg: WorkspacePackage;
    target: string;
} | null;
