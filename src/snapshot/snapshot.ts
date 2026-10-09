import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { lsTree, readBlobs, worktreeFiles } from "../git/repo.js";
import { Limitations } from "../analysis/limitations.js";
import { isIgnoredDir, isSafeRelativePath, isSnapshotFile } from "../util/classify.js";

export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_SNAPSHOT_FILES = 50_000;
const BLOB_BATCH_BYTES = 64 * 1024 * 1024;

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

function createDir(): string {
  // realpath: on macOS tmpdir() is a symlink (/var -> /private/var); the resolver returns real paths.
  return realpathSync(mkdtempSync(join(tmpdir(), "impact-check-")));
}

function safeTarget(dir: string, path: string): string | null {
  if (!isSafeRelativePath(path)) return null;
  const target = resolve(dir, path);
  return target.startsWith(dir + sep) ? target : null;
}

function makeSnapshot(
  dir: string,
  files: string[],
  placeholders: string[],
  limitations: Limitations
): Snapshot {
  const fileSet = new Set(files);
  return {
    dir,
    files,
    placeholders,
    limitations,
    read(path: string): string | null {
      if (!fileSet.has(path)) return null;
      const target = safeTarget(dir, path);
      if (!target) return null;
      try {
        return readFileSync(target, "utf8");
      } catch {
        return null;
      }
    },
    cleanup(): void {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function writePlaceholders(dir: string, paths: string[], budget: number): string[] {
  const written: string[] = [];
  for (const path of paths.slice(0, Math.max(0, budget))) {
    const target = safeTarget(dir, path);
    if (!target) continue;
    try {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, "", { mode: 0o600, flag: "wx" });
      written.push(path);
    } catch {
      // path collides with a directory or an existing file; skip silently (placeholders are best effort)
    }
  }
  return written;
}

function capFiles(paths: string[], limitations: Limitations): string[] {
  if (paths.length <= MAX_SNAPSHOT_FILES) return paths;
  limitations.addCount(
    "file-limit-exceeded",
    `Repository has ${paths.length} analyzable files; only the first ${MAX_SNAPSHOT_FILES} (sorted by path) were analyzed.`,
    paths.length - MAX_SNAPSHOT_FILES
  );
  return paths.slice(0, MAX_SNAPSHOT_FILES);
}

/** Materialize analyzable files of a commit from git objects (no checkout, no hooks, no filters). */
export async function snapshotCommit(root: string, commit: string): Promise<Snapshot> {
  const limitations = new Limitations();
  const entries = (await lsTree(root, commit))
    .filter((e) => !isIgnoredDir(e.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const wanted: { path: string; sha: string; size: number }[] = [];
  const others: string[] = [];
  for (const entry of entries) {
    if (entry.mode === "160000") {
      limitations.add("submodule-skipped", "Git submodules are not analyzed.", entry.path);
      continue;
    }
    if (!isSnapshotFile(entry.path)) {
      if (entry.type === "blob" && entry.mode !== "120000" && isSafeRelativePath(entry.path))
        others.push(entry.path);
      continue;
    }
    if (entry.mode === "120000") {
      limitations.add("symlink-skipped", "Symbolic links are never followed or analyzed.", entry.path);
      continue;
    }
    if (entry.type !== "blob") continue;
    if (!isSafeRelativePath(entry.path)) {
      limitations.add(
        "unsafe-path-skipped",
        "Paths that are unsafe to materialize were skipped.",
        entry.path
      );
      continue;
    }
    if ((entry.size ?? 0) > MAX_FILE_BYTES) {
      limitations.add(
        "file-too-large",
        `Files larger than ${MAX_FILE_BYTES} bytes are not parsed.`,
        entry.path
      );
      continue;
    }
    wanted.push({ path: entry.path, sha: entry.sha, size: entry.size ?? 0 });
  }
  const capped = new Set(
    capFiles(
      wanted.map((w) => w.path),
      limitations
    )
  );
  const selected = wanted.filter((w) => capped.has(w.path));

  const dir = createDir();
  const written: string[] = [];
  try {
    let batch: typeof selected = [];
    let batchBytes = 0;
    const flush = async (): Promise<void> => {
      const blobs = await readBlobs(
        root,
        batch.map((b) => b.sha)
      );
      for (const item of batch) {
        const content = blobs.get(item.sha);
        const target = safeTarget(dir, item.path);
        if (!content || !target) {
          limitations.add(
            "object-missing",
            "Some git objects were unavailable (partial clone?) and were skipped.",
            item.path
          );
          continue;
        }
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content, { mode: 0o600 });
        written.push(item.path);
      }
      batch = [];
      batchBytes = 0;
    };
    for (const item of selected) {
      batch.push(item);
      batchBytes += item.size;
      if (batchBytes >= BLOB_BATCH_BYTES) await flush();
    }
    await flush();
    const placeholders = writePlaceholders(dir, others, MAX_SNAPSHOT_FILES - written.length);
    return makeSnapshot(dir, written.sort(), placeholders, limitations);
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

/** Materialize analyzable files of the working tree (tracked + untracked non-ignored, regular files only). */
export async function snapshotWorktree(root: string): Promise<Snapshot> {
  const limitations = new Limitations();
  const all = (await worktreeFiles(root)).filter((p) => !isIgnoredDir(p));
  const candidates = all.filter((p) => isSnapshotFile(p));
  const others = all.filter((p) => !isSnapshotFile(p) && isSafeRelativePath(p));
  const dir = createDir();
  const written: string[] = [];
  try {
    for (const path of capFiles(candidates, limitations)) {
      const target = safeTarget(dir, path);
      if (!target) {
        limitations.add("unsafe-path-skipped", "Paths that are unsafe to materialize were skipped.", path);
        continue;
      }
      const source = join(root, path);
      let stat;
      try {
        stat = lstatSync(source);
      } catch {
        continue; // deleted in the working tree
      }
      if (stat.isSymbolicLink()) {
        limitations.add("symlink-skipped", "Symbolic links are never followed or analyzed.", path);
        continue;
      }
      if (!stat.isFile()) continue;
      if (stat.size > MAX_FILE_BYTES) {
        limitations.add("file-too-large", `Files larger than ${MAX_FILE_BYTES} bytes are not parsed.`, path);
        continue;
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, readFileSync(source), { mode: 0o600 });
      written.push(path);
    }
    const existing = others.filter((p) => {
      try {
        return lstatSync(join(root, p)).isFile();
      } catch {
        return false;
      }
    });
    const placeholders = writePlaceholders(dir, existing, MAX_SNAPSHOT_FILES - written.length);
    return makeSnapshot(dir, written.sort(), placeholders, limitations);
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}
