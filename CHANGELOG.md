# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semantic versioning.

## [Unreleased]

## [0.2.0-alpha.0] — unreleased (release candidate, 2026-10-09)

### Changed (breaking, pre-release)

- Report **schema 2.0** (snake_case, aligned with the CrewPE Google SDLC addendum): `repo_revision`, `base_revision`,
  `changed_files`, `findings`, `test_candidates`, `coverage_limitations`, `run_metadata`. Mapping in `docs/GOOGLE_SDLC_DELTA.md`.
- Findings carry `status` (`verified_static_fact` / `hypothesis` / `unknown`), `summary`, `recommended_human_action`;
  evidence has `line_start`/`line_end`/`commit`.
- `export-surface-changed` is now AST-based (signature regions; body-only edits no longer flagged).

### Added

- Parser-based export analyzer: `export-removed`, `removed-export-still-imported` (verified; `unknown` with `export *`).
- Evidence-linked affected modules (import line + commit).
- Degraded mode (`analysis_mode`, `no-dependency-graph`); `dynamic-module-loading` and `generated-code` limitations.
- Repository context, `conventions` config, run metrics (`duration_ms`, `timings_ms`, `review_effort`, `model_usage: null`).
- Explicit fail-open/fail-closed: CLI `--on-error`, Action `on-error`, Action output `status`.
- Untrusted-data notice in Markdown; paths in prose rendered as code spans.
- Acceptance fixtures A1–A8 with hand-written expectations and a golden snapshot.

## [0.1.0-alpha.0] — unreleased (release candidate, 2026-10-09)

### Added

- `impact-check analyze | check | render | schema` CLI (offline, deterministic).
- Changed-file detection incl. renames, deletions, binary files, staged/unstaged/untracked in working-tree mode.
- Import graph via dependency-cruiser 18.5.0 (TypeScript 6.0.3 parser), tsconfig `paths`, workspace packages (inferred).
- Reverse-dependency impact with shortest `via` chains, depth/size caps.
- Rules: broken-import, deleted-module-with-dependents (graph facts); export-surface, package-entry,
  package-manifest, migration, api-contract, config, security-sensitive, tests-removed, source-without-test-change,
  wide-blast-radius (heuristics).
- Suggested tests (graph + naming convention), never executed.
- JSON report schema 1.0 and escaped Markdown reporter; secret-like string redaction.
- Composite GitHub Action (read-only, base-branch policy config) and example workflows.
