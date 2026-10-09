import { basename } from "node:path";
import { repoError, usageError } from "../errors.js";
import { firstLine, runGit, splitZ } from "./exec.js";
import type { FileStatus, LineRange } from "../types.js";

const DIFF_FLAGS = [
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--find-renames",
  "--src-prefix=a/",
  "--dst-prefix=b/",
];

export interface RawChange {
  path: string;
  previousPath: string | null;
  status: FileStatus;
}

export interface DiffLine {
  line: number;
  text: string;
}

export interface FileHunks {
  ranges: LineRange[];
  added: DiffLine[];
  removed: DiffLine[];
  truncated: boolean;
}

export interface NumStat {
  additions: number | null;
  deletions: number | null;
  binary: boolean;
}

export interface DiffResult {
  changes: RawChange[];
  numstat: Map<string, NumStat>;
  hunks: Map<string, FileHunks>;
}

const MAX_LINES_PER_FILE = 5000;
const MAX_LINE_TEXT = 400;

/** Validate a user-supplied ref before passing it to git. */
export function validateRef(ref: string, flag: string): string {
  if (ref.length === 0) throw usageError(`${flag} must not be empty`);
  if (ref.length > 256) throw usageError(`${flag} is too long`);
  if (ref.startsWith("-")) throw usageError(`${flag} must not start with "-": ${JSON.stringify(ref)}`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(ref)) throw usageError(`${flag} contains control characters`);
  return ref;
}

export async function repoRoot(cwd: string): Promise<string> {
  const result = await runGit(["rev-parse", "--show-toplevel"], { cwd, allowFailure: true }).catch(
    (error: Error) => {
      throw repoError(error.message);
    }
  );
  if (result.code !== 0) {
    throw repoError(
      `Not a git repository (or git failed): ${firstLine(result.stderr)}`,
      "Run ChangeLens inside a git working tree, or pass --cwd <repo>."
    );
  }
  const root = result.stdout.toString("utf8").trim();
  if (!root) throw repoError("Bare repositories are not supported", "Run ChangeLens in a working tree.");
  return root;
}

export async function resolveCommit(root: string, ref: string): Promise<string | null> {
  const result = await runGit(["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`], {
    cwd: root,
    allowFailure: true,
  });
  if (result.code !== 0) return null;
  return result.stdout.toString("utf8").trim();
}

export async function isShallow(root: string): Promise<boolean> {
  const result = await runGit(["rev-parse", "--is-shallow-repository"], { cwd: root, allowFailure: true });
  return result.stdout.toString("utf8").trim() === "true";
}

export async function mergeBase(root: string, a: string, b: string): Promise<string | null> {
  const result = await runGit(["merge-base", "--end-of-options", a, b], { cwd: root, allowFailure: true });
  if (result.code !== 0) return null;
  return result.stdout.toString("utf8").trim() || null;
}

export function repoName(root: string): string {
  return basename(root);
}

/** Parse `git diff --name-status -z` output. */
export function parseNameStatus(buffer: Buffer): RawChange[] {
  const parts = splitZ(buffer);
  const changes: RawChange[] = [];
  let i = 0;
  while (i < parts.length) {
    const code = parts[i++] ?? "";
    const letter = code.charAt(0);
    if (letter === "R" || letter === "C") {
      const from = parts[i++] ?? "";
      const to = parts[i++] ?? "";
      if (letter === "R") changes.push({ path: to, previousPath: from, status: "renamed" });
      else changes.push({ path: to, previousPath: null, status: "added" });
      continue;
    }
    const path = parts[i++] ?? "";
    const status: FileStatus =
      letter === "A"
        ? "added"
        : letter === "D"
          ? "deleted"
          : letter === "T"
            ? "type-changed"
            : letter === "U"
              ? "unmerged"
              : "modified";
    changes.push({ path, previousPath: null, status });
  }
  return changes;
}

/** Parse `git diff --numstat -z` output (rename-aware). Keyed by new path. */
export function parseNumstat(buffer: Buffer): Map<string, NumStat> {
  const parts = splitZ(buffer);
  const map = new Map<string, NumStat>();
  let i = 0;
  while (i < parts.length) {
    const head = parts[i++] ?? "";
    const fields = head.split("\t");
    const added = fields[0] ?? "-";
    const deleted = fields[1] ?? "-";
    let path = fields.slice(2).join("\t");
    if (path === "") {
      // rename: "<a>\t<d>\t\0old\0new\0"
      i++; // old path
      path = parts[i++] ?? "";
    }
    const binary = added === "-" && deleted === "-";
    map.set(path, {
      additions: binary ? null : Number.parseInt(added, 10),
      deletions: binary ? null : Number.parseInt(deleted, 10),
      binary,
    });
  }
  return map;
}

/** Decode a git C-quoted path ("a\tb\303\251"). */
export function unquoteGitPath(raw: string): string {
  if (!raw.startsWith('"') || !raw.endsWith('"') || raw.length < 2) return raw;
  const body = raw.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    if (ch !== "\\") {
      bytes.push(...Buffer.from(ch, "utf8"));
      continue;
    }
    const next = body[++i] ?? "";
    const simple: Record<string, number> = {
      n: 10,
      t: 9,
      r: 13,
      '"': 34,
      "\\": 92,
      a: 7,
      b: 8,
      f: 12,
      v: 11,
    };
    if (next in simple) bytes.push(simple[next] as number);
    else if (/[0-7]/.test(next)) {
      const oct = body.slice(i, i + 3);
      bytes.push(Number.parseInt(oct, 8));
      i += 2;
    } else bytes.push(...Buffer.from(next, "utf8"));
  }
  return Buffer.from(bytes).toString("utf8");
}

function stripPrefix(header: string, prefix: string): string | null {
  const value = unquoteGitPath(header);
  if (value === "/dev/null") return null;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

/** Parse `git diff -U0` text into per-file head-side ranges and added/removed lines. */
export function parseUnifiedZero(text: string): Map<string, FileHunks> {
  const result = new Map<string, FileHunks>();
  let current: FileHunks | null = null;
  let oldPath: string | null = null;
  let oldLine = 0;
  let newLine = 0;
  const lines = text.split("\n");
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx] as string;
    if (line.startsWith("diff --git ")) {
      current = null;
      oldPath = null;
      continue;
    }
    if (current === null && line.startsWith("--- ")) {
      oldPath = stripPrefix(line.slice(4), "a/");
      const next = lines[idx + 1] ?? "";
      if (next.startsWith("+++ ")) {
        idx++;
        const newPath = stripPrefix(next.slice(4), "b/") ?? oldPath;
        if (newPath !== null) {
          current = { ranges: [], added: [], removed: [], truncated: false };
          result.set(newPath, current);
        }
      }
      continue;
    }
    if (current === null) continue;
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[3]);
      const newCount = hunk[4] === undefined ? 1 : Number(hunk[4]);
      if (newCount > 0) current.ranges.push({ start: newLine, end: newLine + newCount - 1 });
      continue;
    }
    const total = current.added.length + current.removed.length;
    if (line.startsWith("+")) {
      if (total < MAX_LINES_PER_FILE)
        current.added.push({ line: newLine, text: line.slice(1, MAX_LINE_TEXT + 1) });
      else current.truncated = true;
      newLine++;
    } else if (line.startsWith("-")) {
      if (total < MAX_LINES_PER_FILE)
        current.removed.push({ line: oldLine, text: line.slice(1, MAX_LINE_TEXT + 1) });
      else current.truncated = true;
      oldLine++;
    }
  }
  void oldPath;
  return result;
}

/** Diff two commits, or a commit against the working tree when `to` is null. */
export async function diff(root: string, from: string, to: string | null): Promise<DiffResult> {
  const range = to === null ? [from] : [from, to];
  const [nameStatus, numstat, unified] = await Promise.all([
    runGit(["diff", ...DIFF_FLAGS, "--name-status", "-z", "--end-of-options", ...range, "--"], { cwd: root }),
    runGit(["diff", ...DIFF_FLAGS, "--numstat", "-z", "--end-of-options", ...range, "--"], { cwd: root }),
    runGit(["diff", ...DIFF_FLAGS, "-U0", "--end-of-options", ...range, "--"], { cwd: root }),
  ]);
  return {
    changes: parseNameStatus(nameStatus.stdout),
    numstat: parseNumstat(numstat.stdout),
    hunks: parseUnifiedZero(unified.stdout.toString("utf8")),
  };
}

export async function untrackedFiles(root: string): Promise<string[]> {
  const result = await runGit(["ls-files", "--others", "--exclude-standard", "-z", "--full-name"], {
    cwd: root,
  });
  return splitZ(result.stdout).sort();
}

export async function stagedPaths(root: string): Promise<string[]> {
  const result = await runGit(["diff", ...DIFF_FLAGS, "--cached", "--name-only", "-z", "HEAD", "--"], {
    cwd: root,
  });
  return splitZ(result.stdout);
}

export async function unstagedPaths(root: string): Promise<string[]> {
  const result = await runGit(["diff", ...DIFF_FLAGS, "--name-only", "-z", "--"], { cwd: root });
  return splitZ(result.stdout);
}

export interface TreeEntry {
  mode: string;
  type: string;
  sha: string;
  size: number | null;
  path: string;
}

/** List all entries of a commit's tree. */
export async function lsTree(root: string, commit: string): Promise<TreeEntry[]> {
  const result = await runGit(["ls-tree", "-r", "-z", "--long", "--full-tree", "--end-of-options", commit], {
    cwd: root,
  });
  const entries: TreeEntry[] = [];
  for (const record of splitZ(result.stdout)) {
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const [mode = "", type = "", sha = "", size = "-"] = record.slice(0, tab).trim().split(/\s+/);
    entries.push({ mode, type, sha, size: size === "-" ? null : Number(size), path: record.slice(tab + 1) });
  }
  return entries;
}

/** Tracked files in the index plus untracked non-ignored files (worktree mode). */
export async function worktreeFiles(root: string): Promise<string[]> {
  const result = await runGit(
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--full-name"],
    {
      cwd: root,
    }
  );
  return [...new Set(splitZ(result.stdout))].sort();
}

/** Read many blobs via one `git cat-file --batch` process. */
export async function readBlobs(root: string, shas: readonly string[]): Promise<Map<string, Buffer>> {
  const map = new Map<string, Buffer>();
  if (shas.length === 0) return map;
  const unique = [...new Set(shas)];
  const result = await runGit(["cat-file", "--batch"], { cwd: root, input: unique.join("\n") + "\n" });
  const out = result.stdout;
  let offset = 0;
  while (offset < out.length) {
    const newline = out.indexOf(0x0a, offset);
    if (newline < 0) break;
    const header = out.subarray(offset, newline).toString("utf8");
    offset = newline + 1;
    const [sha = "", type = "", sizeText = ""] = header.split(" ");
    if (type === "missing" || sizeText === "") continue;
    const size = Number(sizeText);
    map.set(sha, out.subarray(offset, offset + size));
    offset += size + 1;
  }
  return map;
}

export async function showFile(root: string, commit: string, path: string): Promise<Buffer | null> {
  const result = await runGit(["cat-file", "blob", `${commit}:${path}`], { cwd: root, allowFailure: true });
  return result.code === 0 ? result.stdout : null;
}
