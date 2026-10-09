# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semantic versioning.

## [Unreleased]

## [0.1.0-alpha.0] — unreleased (release candidate, 2026-10-09)

### Added

- `changelens analyze | check | render | schema` CLI (offline, deterministic).
- Changed-file detection incl. renames, deletions, binary files, staged/unstaged/untracked in working-tree mode.
- Import graph via dependency-cruiser 18.5.0 (TypeScript 6.0.3 parser), tsconfig `paths`, workspace packages (inferred).
- Reverse-dependency impact with shortest `via` chains, depth/size caps.
- Rules: broken-import, deleted-module-with-dependents (graph facts); export-surface, package-entry,
  package-manifest, migration, api-contract, config, security-sensitive, tests-removed, source-without-test-change,
  wide-blast-radius (heuristics).
- Suggested tests (graph + naming convention), never executed.
- JSON report schema 1.0 and escaped Markdown reporter; secret-like string redaction.
- Composite GitHub Action (read-only, base-branch policy config) and example workflows.
