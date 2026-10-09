# CLAUDE.md — Impact Check repository conventions

These conventions apply inside this repository. They never override the CrewPE Engineering Commons launch pack
(`../START_HERE.md`, `../MASTER_PROMPT.md`, `../PHASE_GATES.md`) or the user's explicit instructions.

## Commands

- Install: `npm ci --ignore-scripts`
- Full gate: `npm run check:all` (typecheck → lint → format check → build → tests with coverage ≥ 80% lines)
- Licenses: `node scripts/license-audit.mjs` (production) / `--all`
- Sample outputs: `npm run build && node scripts/generate-demo-output.mjs` (commit the result if report output changed)

## Scope

Deterministic, offline JS/TS change-impact CLI + GitHub Action. Out of scope for alpha: LLM features, semantic analysis,
other languages, hosted services, telemetry, executing tests or repository code.

## Invariants (tests enforce most of these)

- No network modules, `exec`, `shell: true`, `eval` in `src/` (`test/security.test.ts`).
- git is spawned only through `src/git/exec.ts` with argument arrays and hardened `-c` config.
- Findings need evidence + provenance + `isHeuristic`; only graph facts may be non-heuristic.
- Output is deterministic except `generatedAt`; arrays sorted; no absolute/temp paths in reports.
- Repo-derived strings are redacted and escaped before rendering; never include file contents or values.
- Fixtures are synthetic only.

## Permission gates

Local commits on the work branch are fine. **Pushing, creating remotes/repos, publishing to npm, opening external
issues/PRs, or enabling third-party services requires explicit user approval for that specific action.**
