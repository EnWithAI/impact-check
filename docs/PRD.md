# Impact Check — Product Requirements (alpha)

## Problem

Reviewers of JS/TS pull requests — especially AI-generated ones — see _which lines_ changed but not _what else depends on
them_, which changes touch sensitive surfaces, or which tests are relevant. Existing tools either execute code, need a
specific monorepo tool (Nx/Turbo), or present opaque "risk" claims.

## User and job

A developer or reviewer with a PR in a JS/TS repository wants to discover affected modules and review/test candidates
**without** the tool pretending to prove semantic correctness.

## Distinctive core

Provenance-driven impact analysis. Every item in the report says where it came from:

- `observed` — read directly from `git diff`;
- `graph` — derived from module resolution by dependency-cruiser;
- `inferred` — a heuristic (naming convention, lexical pattern, workspace mapping).

Findings carry `isHeuristic`, `severity`, `confidence`, a rule ID and evidence (path, side, line when reliable).

## In scope (alpha)

1. Offline, deterministic CLI: `analyze`, `check`, `schema`; `--help`, `--version`.
2. Changed files (add/modify/delete/rename/type-change, binary detection, untracked/staged/unstaged in worktree mode).
3. Head dependency graph + reverse-dependency blast radius with shortest `via` chain and depth/size caps.
4. Base graph when modules are deleted/renamed → dependents in base and confirmed broken imports in head.
5. Heuristic risk rules (see RULES.md), always labelled heuristic unless graph-confirmed.
6. Candidate tests (graph + naming convention + changed tests), all `status: not-run`.
7. Markdown and JSON (schema 1.0) reporters; explicit coverage limitations.
8. Policy `check` with `.impact-check.json` and a distinct exit code.
9. Composite GitHub Action producing a job summary and artifact under `contents: read`.

## Out of scope (alpha)

Semantic/type-level program analysis; non-JS languages; vulnerability scanning; executing tests or package scripts;
LLM features; hosted service; telemetry; PR comment posting as a default.

## Success criterion

A stranger can install Impact Check, run it on a JS/TS repo, get a truthful evidence-backed report, reproduce it offline,
and uninstall it without registering or exposing data.
