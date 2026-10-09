# CLI contract

```
changelens analyze [options]     Analyze and print/write a report. Exit 0 unless a fatal error occurs.
changelens check   [options]     Analyze, then apply the policy from --config. Exit 4 on policy failure.
changelens schema                Print the report JSON Schema.
changelens --help | -h           Usage.
changelens --version | -v        Tool version.
```

## Options (analyze / check)

| Option                             | Default                                                  | Meaning                                                                                                           |
| ---------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `--base <ref>`                     | `main` (falls back to `origin/main` if `main` is absent) | Base ref. Rejected if it starts with `-`.                                                                         |
| `--head <ref>`                     | _(none → working tree)_                                  | Analyze this commit. Uncommitted changes are excluded and reported as a limitation.                               |
| `--worktree`                       | on when `--head` absent                                  | Analyze the working tree (staged + unstaged + untracked, not ignored). Mutually exclusive with `--head`.          |
| `--diff-mode <merge-base\|direct>` | `merge-base`                                             | `merge-base`: compare `merge-base(base, head)` → head (GitHub PR semantics). `direct`: compare base → head.       |
| `--format <markdown\|json>`        | `markdown`                                               | Output format.                                                                                                    |
| `--output <file>`                  | stdout                                                   | Write the report to a file (parent directory must exist).                                                         |
| `--config <file>`                  | `.changelens.json` if present in the cwd repo            | Policy/config (JSON only).                                                                                        |
| `--cwd <dir>`                      | process cwd                                              | Repository directory.                                                                                             |
| `--max-depth <n>`                  | 10                                                       | Max reverse-dependency hops.                                                                                      |
| `--max-affected <n>`               | 500                                                      | Max affected modules listed.                                                                                      |
| `--tsconfig <file>`                | auto (`tsconfig.json`, then `jsconfig.json`)             | tsconfig used for path aliases.                                                                                   |
| `--offline`                        | always on                                                | Accepted for explicitness. ChangeLens never uses the network; git lazy fetch is disabled (`GIT_NO_LAZY_FETCH=1`). |
| `--no-branding`                    | branding on                                              | Omit the one-line footer in Markdown.                                                                             |
| `--quiet`                          | off                                                      | Suppress progress messages on stderr.                                                                             |

## Exit codes

| Code | Meaning                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------- |
| 0    | Success (findings do **not** change the exit code of `analyze`).                                   |
| 1    | Unexpected internal error (bug).                                                                   |
| 2    | Usage or configuration error.                                                                      |
| 3    | Git/repository error (not a repo, unknown ref, shallow clone without merge-base, missing objects). |
| 4    | `check` policy failure.                                                                            |

## Semantics of uncommitted changes

- Working-tree mode includes staged, unstaged and untracked non-ignored files. Their counts are in `comparison.worktree`, and each file's `origin` says where it came from.
- Commit mode (`--head`) excludes them; if any exist, the limitation `dirty-worktree-excluded` is emitted with the count.
- Unmerged (conflicted) paths are listed with status `unmerged` and a limitation.
