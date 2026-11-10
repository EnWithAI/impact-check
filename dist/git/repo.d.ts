import type { FileStatus, LineRange } from "../types.js";
/** One entry of `git diff --name-status` (internal; converted to ChangedFile for the report). */
export interface RawChange {
    path: string;
    previousPath: string | null;
    status: FileStatus;
}
/** An added or removed diff line with its line number on that side. */
export interface DiffLine {
    line: number;
    text: string;
}
/** Changed line information of one file from `git diff -U0`. */
export interface FileHunks {
    ranges: LineRange[];
    added: DiffLine[];
    removed: DiffLine[];
    truncated: boolean;
}
/** Added/deleted line counts of one file; null counts for binary files. */
export interface NumStat {
    additions: number | null;
    deletions: number | null;
    binary: boolean;
}
/** Everything the analysis needs from one diff. */
export interface DiffResult {
    changes: RawChange[];
    numstat: Map<string, NumStat>;
    hunks: Map<string, FileHunks>;
}
/** Validate a user-supplied ref before passing it to git. */
export declare function validateRef(ref: string, flag: string): string;
/**
 * Absolute path of the working tree root containing `cwd`.
 * @throws ImpactCheckError (exit 3) outside a git working tree.
 */
export declare function repoRoot(cwd: string): Promise<string>;
/** Resolves a validated ref to a full commit SHA, or null when it does not exist. */
export declare function resolveCommit(root: string, ref: string): Promise<string | null>;
/** True for shallow clones (history may be missing for merge bases). */
export declare function isShallow(root: string): Promise<boolean>;
/** Best common ancestor of two commits, or null when they share no history. */
export declare function mergeBase(root: string, a: string, b: string): Promise<string | null>;
/** Repository name used in reports: the basename of the root (absolute paths are never emitted). */
export declare function repoName(root: string): string;
/** Parse `git diff --name-status -z` output. */
export declare function parseNameStatus(buffer: Buffer): RawChange[];
/** Parse `git diff --numstat -z` output (rename-aware). Keyed by new path. */
export declare function parseNumstat(buffer: Buffer): Map<string, NumStat>;
/** Decode a git C-quoted path ("a\tb\303\251"). */
export declare function unquoteGitPath(raw: string): string;
/** Parse `git diff -U0` text into per-file head-side ranges and added/removed lines. */
export declare function parseUnifiedZero(text: string): Map<string, FileHunks>;
/** Diff two commits, or a commit against the working tree when `to` is null. */
export declare function diff(root: string, from: string, to: string | null): Promise<DiffResult>;
/** Untracked, non-ignored files (repository-relative, sorted). */
export declare function untrackedFiles(root: string): Promise<string[]>;
/** Paths with unresolved merge conflicts (index stages 1-3). */
export declare function unmergedPaths(root: string): Promise<Set<string>>;
/** Paths with staged changes relative to HEAD. */
export declare function stagedPaths(root: string): Promise<string[]>;
/** Paths with unstaged changes in the working tree. */
export declare function unstagedPaths(root: string): Promise<string[]>;
/** One blob/tree/commit entry of `git ls-tree --long`. */
export interface TreeEntry {
    mode: string;
    type: string;
    sha: string;
    size: number | null;
    path: string;
}
/** List all entries of a commit's tree. */
export declare function lsTree(root: string, commit: string): Promise<TreeEntry[]>;
/** Tracked files in the index plus untracked non-ignored files (worktree mode). */
export declare function worktreeFiles(root: string): Promise<string[]>;
/** Read many blobs via one `git cat-file --batch` process. */
export declare function readBlobs(root: string, shas: readonly string[]): Promise<Map<string, Buffer>>;
/**
 * Read `<commit>:<path>` for many paths with one `git cat-file --batch` process. Paths containing newlines cannot
 * be expressed in the line-based batch protocol and are read individually. Missing paths map to null.
 */
export declare function readPathsAt(root: string, commit: string, paths: readonly string[]): Promise<Map<string, Buffer | null>>;
/** Reads one blob `<commit>:<path>`, or null when it does not exist. */
export declare function showFile(root: string, commit: string, path: string): Promise<Buffer | null>;
