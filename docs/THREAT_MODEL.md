# Threat model (alpha)

## Assets

The user's source code and secrets in the repository or environment; CI credentials (`GITHUB_TOKEN`); the integrity of
the review signal (reports must not be spoofable into misleading reviewers).

## Trust boundaries

1. **Repository content** (files, paths, commit messages, package.json, tsconfig) — untrusted, especially in PRs from forks.
2. **CLI arguments and config** — trusted when typed by a local user; **untrusted when the config comes from a PR head**.
3. **CI environment** — the Action runs with whatever token permissions the workflow grants.
4. **Reports/artifacts** produced by a PR run — untrusted when consumed by a later privileged workflow.

## Threats and mitigations

| #   | Threat                                                                                        | Mitigation                                                                                                                                                                                                                                                                               | Test                                                            |
| --- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| T1  | Code execution via repo content (npm scripts, JS configs, git hooks, diff drivers, fsmonitor) | Never run package scripts or load JS configs; dependency-cruiser called via API without webpack/babel config; git spawned with `--no-ext-diff --no-textconv -c core.fsmonitor=false`, `GIT_OPTIONAL_LOCKS=0`; snapshots read via `cat-file`, not checkout (no hooks/filters/LFS smudge). | `security.test.ts` (canary scripts never run)                   |
| T2  | Argument/option injection via refs or paths                                                   | `spawn` with arg arrays; refs starting with `-` rejected; `--end-of-options`; pathspecs never built from user strings.                                                                                                                                                                   | `cli.test.ts`, `git.test.ts`                                    |
| T3  | Path traversal / symlink escape when materializing snapshots                                  | Git paths validated (no absolute, no `..`, no NUL, resolved inside temp root); symlinks and submodules skipped and reported; worktree files read with `lstat` (regular files only).                                                                                                      | `snapshot.test.ts`                                              |
| T4  | Malicious filenames (newlines, backticks, HTML, `@mentions`, control chars) spoofing Markdown | All repo strings rendered inside escaped code spans; control chars shown as escapes; `@` and HTML inert in code spans; size caps.                                                                                                                                                        | `markdown.test.ts`, `edge-cases.test.ts`                        |
| T5  | Secret leakage into reports/logs                                                              | Reports contain paths, line numbers, export names, specifiers and manifest field names only — never file contents or values; redactor masks token-like strings; env vars never printed; `.env*` files are never read.                                                                    | `redact.test.ts`                                                |
| T6  | Resource exhaustion (huge repos/diffs)                                                        | git timeouts and output caps; per-file size cap (1 MiB) for parsing; file count cap; depth/affected caps; report section caps.                                                                                                                                                           | `limits.test.ts`                                                |
| T7  | Network exfiltration / telemetry                                                              | No network code; `GIT_NO_LAZY_FETCH=1` prevents partial-clone fetches. No telemetry.                                                                                                                                                                                                     | `security.test.ts` (no `http`/`https`/`fetch` imports in `src`) |
| T8  | Privileged CI misuse (`pull_request_target` running PR code with secrets)                     | Action documented for `pull_request` + `contents: read` only; no PR code executed; inputs passed via `env`, not `${{ }}` in scripts.                                                                                                                                                     | `action.test.ts` (workflow lint)                                |
| T9  | Spoofed artifact consumed by a privileged comment workflow                                    | Optional `workflow_run` template: validates JSON against the schema, re-renders Markdown with the base-branch ChangeLens (escaping again), takes PR number from the event payload, `pull-requests: write` only. Remote run **untested** in alpha.                                        | template review                                                 |
| T10 | Policy bypass via PR-supplied `.changelens.json`                                              | Action loads config from the **base** commit (`git show <base>:.changelens.json`) by default.                                                                                                                                                                                            | `action.test.ts`                                                |
| T11 | Supply chain of ChangeLens itself                                                             | Two exact-pinned runtime deps; lockfile; `npm ci --ignore-scripts`; Actions pinned by SHA; license audit.                                                                                                                                                                                | release checklist                                               |
| T12 | Prompt injection: PR content (comments, strings, file names) addressed to AI agents           | ChangeLens has no model and interprets no content as instructions; comments/strings are never copied into reports; file names are escaped; the Markdown header tells downstream readers (incl. AI reviewers) that repository strings are data; CONTEXT_CONTRACT §4.                      | `test/acceptance/a6-injection.test.ts`                          |
| T13 | Misleading certainty: a hypothesis presented as a fact                                        | Tri-state `status`; only git/resolver/parser facts may be `verified_static_fact`; status shown on every Markdown finding; limitations listed.                                                                                                                                            | `test/acceptance/a2-*`, `a3-*`                                  |

## Misuse cases (spec-first, invariant 1)

| Misuse                                                                      | Expected behavior                                                                               |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Using `check` as an automatic merge approver                                | Not supported: ChangeLens never approves or merges; docs state that `check` is a policy signal. |
| Treating "no findings" as "safe to merge"                                   | Report lists limitations; CONTEXT_CONTRACT §4.3.                                                |
| Running the Action under `pull_request_target` with secrets                 | Documented as unsupported; workflow lint rejects it in our repository.                          |
| Feeding the whole repository to an AI reviewer "because ChangeLens said so" | Contract recommends pulling only cited lines.                                                   |
| Shipping a PR-supplied `.changelens.json` that disables the policy          | Action reads config from the base commit by default.                                            |

## Misuse cases (spec-first, invariant 1)

| Misuse                                                      | Expected behavior                                                             |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Using `check` as an automatic merge approver                | Unsupported: ChangeLens never approves or merges; `check` is a policy signal. |
| Treating "no findings" as "safe"                            | Report lists limitations; CONTEXT_CONTRACT §4.3.                              |
| Running the Action under `pull_request_target` with secrets | Documented as unsupported; workflow lint rejects it here.                     |
| Feeding the whole repository to an AI reviewer              | Contract recommends pulling only cited lines.                                 |
| PR-supplied `.changelens.json` disabling the policy         | Action reads config from the base commit by default.                          |

## Residual risks

- dependency-cruiser and TypeScript parse untrusted source. Parser bugs (DoS) are possible; mitigated by size caps and timeouts at the CI-job level, not per file.
- `tsconfig.json` `extends` may reference files outside the snapshot (read as JSON by TypeScript, never executed).
- Report text is still attacker-influenced (escaped) — reviewers should treat file names as data.
