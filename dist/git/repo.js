// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
/**
 * Git adapter: ref validation and resolution, merge base, diffs (name-status, numstat, -U0 hunks),
 * working-tree state (staged/unstaged/untracked/unmerged) and batched object reads. Pure parsers for git's
 * NUL-separated and C-quoted output are exported for unit testing.
 */
import { basename } from "node:path";
import { repoError, usageError } from "../errors.js";
import { firstLine, runGit, splitZ } from "./exec.js";
const DIFF_FLAGS = [
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--find-renames",
    "--src-prefix=a/",
    "--dst-prefix=b/",
];
const MAX_LINES_PER_FILE = 5000;
const MAX_LINE_TEXT = 400;
/** Validate a user-supplied ref before passing it to git. */
export function validateRef(ref, flag) {
    if (ref.length === 0)
        throw usageError(`${flag} must not be empty`);
    if (ref.length > 256)
        throw usageError(`${flag} is too long`);
    if (ref.startsWith("-"))
        throw usageError(`${flag} must not start with "-": ${JSON.stringify(ref)}`);
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(ref))
        throw usageError(`${flag} contains control characters`);
    return ref;
}
/**
 * Absolute path of the working tree root containing `cwd`.
 * @throws ImpactCheckError (exit 3) outside a git working tree.
 */
export async function repoRoot(cwd) {
    const result = await runGit(["rev-parse", "--show-toplevel"], { cwd, allowFailure: true }).catch((error) => {
        throw repoError(error.message);
    });
    if (result.code !== 0) {
        throw repoError(`Not a git repository (or git failed): ${firstLine(result.stderr)}`, "Run Impact Check inside a git working tree, or pass --cwd <repo>.");
    }
    const root = result.stdout.toString("utf8").trim();
    if (!root)
        throw repoError("Bare repositories are not supported", "Run Impact Check in a working tree.");
    return root;
}
/** Resolves a validated ref to a full commit SHA, or null when it does not exist. */
export async function resolveCommit(root, ref) {
    const result = await runGit(["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`], {
        cwd: root,
        allowFailure: true,
    });
    if (result.code !== 0)
        return null;
    return result.stdout.toString("utf8").trim();
}
/** True for shallow clones (history may be missing for merge bases). */
export async function isShallow(root) {
    const result = await runGit(["rev-parse", "--is-shallow-repository"], { cwd: root, allowFailure: true });
    return result.stdout.toString("utf8").trim() === "true";
}
/** Best common ancestor of two commits, or null when they share no history. */
export async function mergeBase(root, a, b) {
    const result = await runGit(["merge-base", "--end-of-options", a, b], { cwd: root, allowFailure: true });
    if (result.code !== 0)
        return null;
    return result.stdout.toString("utf8").trim() || null;
}
/** Repository name used in reports: the basename of the root (absolute paths are never emitted). */
export function repoName(root) {
    return basename(root);
}
/** Parse `git diff --name-status -z` output. */
export function parseNameStatus(buffer) {
    const parts = splitZ(buffer);
    const changes = [];
    let i = 0;
    while (i < parts.length) {
        const code = parts[i++] ?? "";
        const letter = code.charAt(0);
        if (letter === "R" || letter === "C") {
            const from = parts[i++] ?? "";
            const to = parts[i++] ?? "";
            if (letter === "R")
                changes.push({ path: to, previousPath: from, status: "renamed" });
            else
                changes.push({ path: to, previousPath: null, status: "added" });
            continue;
        }
        const path = parts[i++] ?? "";
        const status = letter === "A"
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
export function parseNumstat(buffer) {
    const parts = splitZ(buffer);
    const map = new Map();
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
export function unquoteGitPath(raw) {
    if (!raw.startsWith('"') || !raw.endsWith('"') || raw.length < 2)
        return raw;
    const body = raw.slice(1, -1);
    const bytes = [];
    for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (ch !== "\\") {
            bytes.push(...Buffer.from(ch, "utf8"));
            continue;
        }
        const next = body[++i] ?? "";
        const simple = {
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
        if (next in simple)
            bytes.push(simple[next]);
        else if (/[0-7]/.test(next)) {
            const oct = body.slice(i, i + 3);
            bytes.push(Number.parseInt(oct, 8));
            i += 2;
        }
        else
            bytes.push(...Buffer.from(next, "utf8"));
    }
    return Buffer.from(bytes).toString("utf8");
}
/** Unquotes a diff header path and strips its `a/` or `b/` prefix; null for /dev/null. */
function stripPrefix(header, prefix) {
    const value = unquoteGitPath(header);
    if (value === "/dev/null")
        return null;
    return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}
/** Parse `git diff -U0` text into per-file head-side ranges and added/removed lines. */
export function parseUnifiedZero(text) {
    const result = new Map();
    let current = null;
    let oldPath = null;
    let oldLine = 0;
    let newLine = 0;
    const lines = text.split("\n");
    for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx];
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
        if (current === null)
            continue;
        const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
        if (hunk) {
            oldLine = Number(hunk[1]);
            newLine = Number(hunk[3]);
            const newCount = hunk[4] === undefined ? 1 : Number(hunk[4]);
            if (newCount > 0)
                current.ranges.push({ start: newLine, end: newLine + newCount - 1 });
            continue;
        }
        const total = current.added.length + current.removed.length;
        if (line.startsWith("+")) {
            if (total < MAX_LINES_PER_FILE)
                current.added.push({ line: newLine, text: line.slice(1, MAX_LINE_TEXT + 1) });
            else
                current.truncated = true;
            newLine++;
        }
        else if (line.startsWith("-")) {
            if (total < MAX_LINES_PER_FILE)
                current.removed.push({ line: oldLine, text: line.slice(1, MAX_LINE_TEXT + 1) });
            else
                current.truncated = true;
            oldLine++;
        }
    }
    void oldPath;
    return result;
}
/** Diff two commits, or a commit against the working tree when `to` is null. */
export async function diff(root, from, to) {
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
/** Untracked, non-ignored files (repository-relative, sorted). */
export async function untrackedFiles(root) {
    const result = await runGit(["ls-files", "--others", "--exclude-standard", "-z", "--full-name"], {
        cwd: root,
    });
    return splitZ(result.stdout).sort();
}
/** Paths with unresolved merge conflicts (index stages 1-3). */
export async function unmergedPaths(root) {
    const result = await runGit(["ls-files", "--unmerged", "-z", "--full-name"], { cwd: root });
    return new Set(splitZ(result.stdout).map((r) => r.slice(r.indexOf("\t") + 1)));
}
/** Paths with staged changes relative to HEAD. */
export async function stagedPaths(root) {
    const result = await runGit(["diff", ...DIFF_FLAGS, "--cached", "--name-only", "-z", "HEAD", "--"], {
        cwd: root,
    });
    return splitZ(result.stdout);
}
/** Paths with unstaged changes in the working tree. */
export async function unstagedPaths(root) {
    const result = await runGit(["diff", ...DIFF_FLAGS, "--name-only", "-z", "--"], { cwd: root });
    return splitZ(result.stdout);
}
/** List all entries of a commit's tree. */
export async function lsTree(root, commit) {
    const result = await runGit(["ls-tree", "-r", "-z", "--long", "--full-tree", "--end-of-options", commit], {
        cwd: root,
    });
    const entries = [];
    for (const record of splitZ(result.stdout)) {
        const tab = record.indexOf("\t");
        if (tab < 0)
            continue;
        const [mode = "", type = "", sha = "", size = "-"] = record.slice(0, tab).trim().split(/\s+/);
        entries.push({ mode, type, sha, size: size === "-" ? null : Number(size), path: record.slice(tab + 1) });
    }
    return entries;
}
/** Tracked files in the index plus untracked non-ignored files (worktree mode). */
export async function worktreeFiles(root) {
    const result = await runGit(["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--full-name"], {
        cwd: root,
    });
    return [...new Set(splitZ(result.stdout))].sort();
}
/** Read many blobs via one `git cat-file --batch` process. */
export async function readBlobs(root, shas) {
    const map = new Map();
    if (shas.length === 0)
        return map;
    const unique = [...new Set(shas)];
    const result = await runGit(["cat-file", "--batch"], { cwd: root, input: unique.join("\n") + "\n" });
    const out = result.stdout;
    let offset = 0;
    while (offset < out.length) {
        const newline = out.indexOf(0x0a, offset);
        if (newline < 0)
            break;
        const header = out.subarray(offset, newline).toString("utf8");
        offset = newline + 1;
        const [sha = "", type = "", sizeText = ""] = header.split(" ");
        if (type === "missing" || sizeText === "")
            continue;
        const size = Number(sizeText);
        map.set(sha, out.subarray(offset, offset + size));
        offset += size + 1;
    }
    return map;
}
/**
 * Read `<commit>:<path>` for many paths with one `git cat-file --batch` process. Paths containing newlines cannot
 * be expressed in the line-based batch protocol and are read individually. Missing paths map to null.
 */
export async function readPathsAt(root, commit, paths) {
    const result = new Map();
    const batchable = [...new Set(paths)].filter((p) => !/[\r\n]/.test(p));
    for (const p of paths)
        if (/[\r\n]/.test(p))
            result.set(p, await showFile(root, commit, p));
    if (batchable.length === 0)
        return result;
    const out = (await runGit(["cat-file", "--batch"], {
        cwd: root,
        input: batchable.map((p) => `${commit}:${p}`).join("\n") + "\n",
    })).stdout;
    let offset = 0;
    for (const path of batchable) {
        const newline = out.indexOf(0x0a, offset);
        if (newline < 0)
            break;
        const header = out.subarray(offset, newline).toString("utf8");
        offset = newline + 1;
        const match = /^[0-9a-f]+ (\w+) (\d+)$/.exec(header);
        if (!match) {
            result.set(path, null); // "<name> missing" / "ambiguous"
            continue;
        }
        const size = Number(match[2]);
        result.set(path, match[1] === "blob" ? out.subarray(offset, offset + size) : null);
        offset += size + 1;
    }
    return result;
}
/** Reads one blob `<commit>:<path>`, or null when it does not exist. */
export async function showFile(root, commit, path) {
    const result = await runGit(["cat-file", "blob", `${commit}:${path}`], { cwd: root, allowFailure: true });
    return result.code === 0 ? result.stdout : null;
}
