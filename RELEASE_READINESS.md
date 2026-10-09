# Release readiness — Impact Check 0.2.0-alpha.0

Date: 2026-10-09 · Branch `alpha/impact-check-0.2-sdlc` (local only) · Code commit `5024167` · Report schema 2.0

## Verdict

**READY FOR HUMAN REVIEW** against the addendum acceptance gate, with the open items below. **Not published.**
Public release remains blocked on the Phase 6 decisions (name, repository, npm account) and on running the Action
on GitHub for the first time.

| Addendum gate condition                   | Result             | Evidence                                                                               |
| ----------------------------------------- | ------------------ | -------------------------------------------------------------------------------------- |
| Local CLI works without an API key        | ✅                 | Installed tarball run under a network-denied sandbox; `run_metadata.model_usage: null` |
| Reproducible, evidence-backed output      | ✅                 | Golden snapshot (A8), byte-identical sample outputs, fresh-clone gate                  |
| 8 fixture categories tested               | ✅ (A7 local only) | `docs/VERIFICATION_MATRIX.md`; red run then green                                      |
| Safe Action permission choices documented | ✅                 | `docs/ACTION.md`, workflow lint test, A7 no-secret-access test                         |
| No critical open security issues          | ✅                 | Security findings below (none critical open)                                           |
| Report shows limits                       | ✅                 | `coverage_limitations`, degraded mode, untrusted-data notice                           |
| Docs permit third-party reproduction      | ✅                 | README quickstart verified in a fresh clone                                            |

## Test results (commands run on 2026-10-09; Node 25.9.0, macOS)

| Command                                                       | Result                                                                                  |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `npm run check:all`                                           | exit 0 — 17 files, **108 passed**, 1 skipped placeholder; lines 95.23%, branches 83.53% |
| Fresh clone → `npm ci --ignore-scripts` → `npm run check:all` | exit 0, same counts                                                                     |
| Acceptance A1–A8 before implementation                        | 14 failed / 1 passed (`docs/evidence/acceptance-red-run.txt`)                           |
| Acceptance A1–A8 after implementation                         | 15 / 15 passed                                                                          |
| Scale: 2,001-module graph; 1,000 changed exporting modules    | 534 ms (v0.1 measurement); 737 ms                                                       |
| `npm audit` (prod / all)                                      | 0 / 0 vulnerabilities                                                                   |
| License audit (prod / all)                                    | 44 / 83 packages, 0 disallowed                                                          |
| `npm pack`                                                    | 66 files, 63.1 kB; clean install OK; `--version` → 0.2.0-alpha.0                        |

## Coverage limits (what is not proven)

- Static only: no type checking, no runtime behavior. `verified_static_fact` is a parser/resolver/git fact.
- Export analysis: ESM named exports only; `export *` → `unknown`; CommonJS shapes and `ns.member` usage not
  analyzed; consumers behind barrel re-exports not followed (reported as `export-analysis-incomplete`).
- Single-line declarations: any edit on the line counts as a signature change (hypothesis).
- One tsconfig for aliases; bundler aliases not read; workspace edges inferred by convention.
- `imports-not-extracted` limitation branch not exercised by any fixture (parsers recovered every broken input tried).
- Not run: GitHub-hosted Action, fork PR on GitHub, comment workflow, Node 22/24/26, Windows.

## Security findings (this sprint)

| ID                                 | Finding                                                                                                                    | Severity | Status                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| S-1                                | Instruction-like file names appeared as rendered prose in finding headings (escaped, but readable as text by AI reviewers) | medium   | **Fixed**: paths in prose are rendered as code spans; untrusted-data notice in every report (A6) |
| S-2                                | Tool errors had implicit blocking behavior in CI                                                                           | low      | **Fixed**: explicit `on-error` (fail-open/closed) per check type (A7)                            |
| S-3                                | Per-file `git` spawns for base reads (resource use on large PRs)                                                           | low      | **Fixed**: single batched `cat-file --batch`                                                     |
| S-4                                | Report text remains attacker-influenced (paths, identifiers)                                                               | info     | Accepted, mitigated: escaping, redaction, notice, CONTEXT_CONTRACT §4                            |
| S-5                                | Optional comment workflow (privileged `workflow_run`) untested on GitHub                                                   | medium   | **Open**: keep it labelled experimental; test per `docs/ACTION.md` after approval                |
| S-6                                | TypeScript parser now also parses dependents of changed modules (parser DoS surface)                                       | low      | Accepted: 1 MiB per-file cap, CI job timeouts                                                    |
| S-7                                | User's own git clean/smudge filter config can run in worktree mode                                                         | info     | Accepted, documented (user-trusted config)                                                       |
| No critical or high open findings. |

## License and dependency review

Runtime: `dependency-cruiser@18.5.0` (MIT), `typescript@6.0.3` (Apache-2.0) — exact pins; 44 production packages
(MIT 40, ISC 3, Apache-2.0 1). Original code under MIT (© 2026 EnWithAI Technologies — **legal review pending**).
No third-party code copied; the BUSL-licensed npm `changelens` package was not inspected.

## Known risks

1. **Naming**: resolved by renaming the product to **Impact Check** (`@enwithai/impact-check`); the unscoped npm name `changelens` belongs to an unrelated BUSL tool. A formal trademark check of the new names is still pending.
2. **Schema 2.0 naming** chosen per the addendum over the master prompt's camelCase examples (D-040); reversible now, costly after release.
3. First remote CI/Action run may surface Linux/Node-version issues not seen locally.

## Costs

Model/API cost of Impact Check itself: none (no model calls). Build-session cost: not available (no metering exposed).
No external services or paid resources were used.

## Next milestones (each needs your approval)

1. Phase 6 decisions → private test repository → CI matrix + Action self-test + fork-PR test (closes S-5 and A7 remote).
2. Publish `0.2.0-alpha.x` under the chosen name with npm provenance; announce.
3. Measure genuine usage; then a fresh go/no-go for Spec Check (design notes in `progress/`), later Outcome Check.
