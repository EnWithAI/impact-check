# Verification matrix

Requirement → test that proves it → status at `alpha/impact-check-0.2-sdlc`. "Red first" marks tests written and
observed failing before the implementation (verification-first, `docs/evidence/acceptance-red-run.txt`).

## Addendum acceptance fixtures (A1–A8)

| ID  | Requirement                                                                                          | Test                                                               | Red first                                          | Status                                          |
| --- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------- | ----------------------------------------------- |
| A1  | Known reverse imports → evidence-linked consumers (import line + commit)                             | `test/acceptance/a1-a5…` "A1" + `expected/a1-reverse-imports.json` | yes                                                | pass                                            |
| A2  | Internal-only change → no unsupported breaking-API claim                                             | "A2" + `expected/a2-internal-change.json`                          | yes                                                | pass                                            |
| A3a | Removed export still imported → `verified_static_fact`                                               | "A3 a" + `expected/a3a-…`                                          | yes                                                | pass                                            |
| A3b | Renamed export → removal fact, possible rename, every importer                                       | "A3 b" + `expected/a3b-…`                                          | yes                                                | pass                                            |
| A3c | `export *` present → `unknown`, never high                                                           | "A3 c" + `expected/a3c-…`                                          | yes                                                | pass                                            |
| A3d | Signature change → `hypothesis` only                                                                 | "A3 d" + `expected/a3d-…`                                          | yes                                                | pass                                            |
| A4  | Dynamic import / reflection-style loading / generated code → limitations                             | "A4" + `expected/a4-…`                                             | yes                                                | pass                                            |
| A5  | No dependency graph → `degraded`, no impact claims                                                   | "A5" + `expected/a5-degraded.json`                                 | yes                                                | pass                                            |
| A6  | Injected instructions in diff ignored (instruction invariance), names escaped, untrusted-data notice | `a6-injection.acceptance.test.ts`                                  | yes                                                | pass                                            |
| A7  | Fork PR: no token/secret ever read; explicit fail-open/closed                                        | `a7-action-permissions.acceptance.test.ts`                         | yes (fork test already passed; on-error tests red) | pass locally; **remote fork run not performed** |
| A8  | Schema 2.0 validation; identical output across runs and fresh repos; golden snapshot                 | `a8-determinism.acceptance.test.ts`, `golden/a8-mixed.json`        | yes                                                | pass                                            |

## Contract diff and graph export (0.3.0 candidate, design notes §7.1)

Red run before implementation: `docs/evidence/contract-graph-red-run.txt` (spec commit `5acb549`). Pointers and lines
in `test/contract/fixtures/*/expected.json` and `test/expected/g1-graph.json` were computed by hand.

| ID    | Requirement                                                                                      | Test                                                  | Red first | Status |
| ----- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | --------- | ------ |
| I-C1  | Path, operation (OpenAPI); channel, operation, message (AsyncAPI 2.6) removed → verified break   | `test/contract/contract.acceptance.test.ts` + `i-c1/` | yes       | pass   |
| I-C2  | Response status (incl. `default`) removed, JSON file                                             | `i-c2/`                                               | yes       | pass   |
| I-C3  | Required parameter / request property added (new and existing, through `$ref`)                   | `i-c3/`                                               | yes       | pass   |
| I-C4  | Response property removed (nested, through `$ref`); renamed path parameter is not a break        | `i-c4/`                                               | yes       | pass   |
| I-C5  | Payload type narrowed (AsyncAPI 3.0); widening only unclassified                                 | `i-c5/`                                               | yes       | pass   |
| I-C6  | Request enum value removed; added request enum value compatible                                  | `i-c6/`                                               | yes       | pass   |
| I-C7  | Server removed; trailing slash/description changes ignored                                       | `i-c7/`                                               | yes       | pass   |
| I-C8  | Security scheme removed; server security change unclassified                                     | `i-c8/`                                               | yes       | pass   |
| I-C9  | Cosmetic-only change → zero contract findings                                                    | `i-c9/`                                               | yes       | pass   |
| I-C10 | Remote `$ref` → `unknown` + `contract-diff-incomplete`; URL never printed                        | `i-c10/`                                              | yes       | pass   |
| —     | Unknowns (parse, version, format, size, aliases, depth), AsyncAPI 3.0, request bodies, fallbacks | `test/contract/contract.unit.test.ts`                 | no        | pass   |
| G1    | `graph` output equals the hand-written graph; schema-valid; deterministic; usage errors          | `test/graph.test.ts` + `test/expected/g1-graph.json`  | yes       | pass   |

## Engineering invariants

| #   | Invariant                         | Evidence                                                                                                                                                                                       |
| --- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Spec-first                        | PRD, CLI, RULES, CONTEXT_CONTRACT, THREAT_MODEL (misuse cases), this matrix; spec commit `5d6b3ab` precedes implementation                                                                     |
| 2   | Context-aware                     | `repository.context` (A8 golden), CONTEXT_CONTRACT; `conventions` config (`test/cli.test.ts`, config tests)                                                                                    |
| 3   | Harness-driven                    | hardened git (`test/security.test.ts` canaries with positive control), caps (`test/limits.test.ts`), exit codes (`test/cli.test.ts`)                                                           |
| 4   | Verification-first                | red run recorded; `test/exports.test.ts` written before `src/analyzers/exports.ts`; negative (A2, A5), boundary (limits), adversarial (A6, security) fixtures                                  |
| 5   | Evidence & status                 | schema requires `status`, `evidence[].{line_start,line_end,commit}`, `recommended_human_action`; harness asserts `is_heuristic == (status != verified_static_fact)` for every expected finding |
| 6   | Human authority, fail-open/closed | A7 on-error matrix; CLI.md "Informational vs blocking"; no merge/approve code paths exist                                                                                                      |
| 7   | Economics                         | `run_metadata.duration_ms`, `timings_ms`, `review_effort`, `model_usage: null` (schema-validated)                                                                                              |
| 8   | Model independence                | no model code; `test/security.test.ts` bans network modules/fetch                                                                                                                              |
| 9   | Reproducibility                   | pinned deps, fixed-date fixtures, golden snapshot, sample outputs byte-compared (`test/quickstart.test.ts`)                                                                                    |
| 10  | Security / prompt injection       | A6, THREAT_MODEL T12/T13, render re-escaping (`test/action.test.ts`)                                                                                                                           |

## Pre-existing acceptance (PHASE_GATES A–J)

Unchanged mapping in `docs/ACCEPTANCE.md`; all re-run green on schema 2.0 (106 tests).

## Not verified (open)

| Item                                            | Why                                             | Plan                                                  |
| ----------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| GitHub-hosted Action, fork PR, comment workflow | No remote; publication gate                     | Manual plan in `docs/ACTION.md` after approval        |
| Node 22/24/26                                   | Only Node 25 local                              | CI matrix on first push                               |
| Windows                                         | Not available                                   | Mark unsupported until tested                         |
| `imports-not-extracted` branch                  | Parsers recovered imports from all tried inputs | Keep limitation; add fixture if a reproducer is found |
