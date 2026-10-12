import { Limitations } from "../analysis/limitations.js";
/** Files larger than this are not parsed (reported as `file-too-large`). */
export declare const MAX_FILE_BYTES: number;
/** Maximum number of files materialized per snapshot (reported as `file-limit-exceeded`). */
export declare const MAX_SNAPSHOT_FILES = 50000;
/** A private, read-only-by-convention copy of the analyzable files of one repository state. */
export interface Snapshot {
    dir: string;
    /** Analyzable files with real content (JS/TS + package.json/tsconfig). */
    files: string[];
    /** Other tracked files, materialized as empty placeholders so imports of assets/JSON resolve. */
    placeholders: string[];
    limitations: Limitations;
    read(path: string): string | null;
    cleanup(): void;
}
/** Materialize analyzable files of a commit from git objects (no checkout, no hooks, no filters). */
export declare function snapshotCommit(root: string, commit: string): Promise<Snapshot>;
/** Materialize analyzable files of the working tree (tracked + untracked non-ignored, regular files only). */
export declare function snapshotWorktree(root: string): Promise<Snapshot>;
