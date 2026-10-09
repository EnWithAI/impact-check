# ChangeLens impact report

> Deterministic static analysis of module imports and diff lines. Findings marked **heuristic** are prompts for review, not proven defects. **No tests or repository code were executed.**

**Comparison:** `main` (`e4b4f7a877d2`) → working tree (HEAD `cef3c01cb043` + uncommitted changes) · mode `merge-base` · merge-base `e4b4f7a877d2`

**Uncommitted changes included:** 0 staged, 0 unstaged, 0 untracked

| Files changed | JS/TS files | Affected modules | Findings (high / medium / low / info) | Test candidates | Limitations |
|---:|---:|---:|---|---:|---:|
| 4 | 3 | 8 | 1 / 4 / 1 / 1 | 2 | 4 |

## Risk findings

### HIGH · Import of deleted module no longer resolves: src/lib/legacy-tax.ts

`broken-import` · **confirmed by resolver** · confidence high · provenance graph (resolved import)

In the base graph these modules resolved an import to src/lib/legacy-tax.ts, which was deleted. In the head state the same import specifier cannot be resolved by dependency-cruiser. Unless resolution depends on configuration ChangeLens does not see (e.g. bundler aliases), this import is broken.

- `src/lib/legacy-tax.ts` (base) — deleted
- `src/cart/cart.ts:2` (head) — imports "../lib/legacy-tax" (no longer resolves)

### MEDIUM · Deleted module had 1 dependent(s) in base: src/lib/legacy-tax.ts

`deleted-module-with-dependents` · **confirmed by resolver** · confidence high · provenance graph (resolved import)

1 of these dependents were not modified in this change. Verify they no longer rely on src/lib/legacy-tax.ts.

- `src/lib/legacy-tax.ts` (base) — deleted
- `src/cart/cart.ts` (base) — imported "../lib/legacy-tax"

### MEDIUM · Potential public interface change in src/lib/money.ts

`export-surface-changed` · heuristic · confidence medium · provenance inferred (heuristic)

Diff lines that declare exports were removed or modified (1 removed/modified, 1 added line(s)). The module has 1 direct dependent(s) in the head graph. ChangeLens compares lines, not types: this may be fully compatible.

- `src/lib/money.ts:1` (base) — modified: function formatCents
- `src/lib/money.ts:1` (head) — modified: function formatCents

### MEDIUM · Database migration or schema files changed (1 file)

`migration-changed` · heuristic · confidence medium · provenance inferred (heuristic)

Migrations can be irreversible or require coordinated deploys. Check ordering, rollback and data impact. Detected by path convention only.

- `db/migrations/002_add_currency.sql:1` (head) — added

### MEDIUM · Security-sensitive area changed: src/auth/session.ts

`security-sensitive-change` · heuristic · confidence medium · provenance graph (resolved import)

The path name or imports suggest authentication, session, cryptography or access-control code. ChangeLens does not scan for vulnerabilities; this is a prompt for focused review.

- `src/auth/session.ts` (head) — security-related path name
- `src/auth/session.ts:1` (head) — imports "node:crypto"

### LOW · Potential public interface change in src/auth/session.ts

`export-surface-changed` · heuristic · confidence medium · provenance inferred (heuristic)

Diff lines that declare exports were removed or modified (1 removed/modified, 1 added line(s)). The module has 0 direct dependent(s) in the head graph. ChangeLens compares lines, not types: this may be fully compatible.

- `src/auth/session.ts:3` (base) — modified: const sign
- `src/auth/session.ts:3` (head) — modified: const sign

### INFO · Source changed without test changes (2 modules)

`source-without-test-change` · heuristic · confidence medium · provenance inferred (heuristic)

No test file was modified in this change. Existing tests may still cover it; see suggested tests.

- `src/auth/session.ts` (head) — modified
- `src/lib/money.ts` (head) — modified

## Changed files

| Status | File | Kind | +/− | Origin |
|---|---|---|---|---|
| added | `db/migrations/002_add_currency.sql` | other | +1 / −0 | committed |
| modified | `src/auth/session.ts` | source | +1 / −1 | committed |
| deleted | `src/lib/legacy-tax.ts` | source | +0 / −1 | committed |
| modified | `src/lib/money.ts` | source | +2 / −2 | committed |

## Affected modules (reverse dependencies)

Changed modules themselves are listed under *Changed files*. Hops count reverse-import steps from the nearest changed module.

| Module | Hops | Provenance | Shortest path from a changed module |
|---|---:|---|---|
| `src/cart/cart.ts` | 1 | graph | `src/lib/legacy-tax.ts` ← `src/cart/cart.ts` |
| `src/cart/cart.test.ts` | 2 | graph | `src/lib/legacy-tax.ts` ← `src/cart/cart.ts` ← `src/cart/cart.test.ts` |
| `src/checkout/checkout.ts` | 2 | graph | `src/lib/legacy-tax.ts` ← `src/cart/cart.ts` ← `src/checkout/checkout.ts` |
| `src/index.ts` | 3 | graph | `src/lib/legacy-tax.ts` ← `src/cart/cart.ts` ← `src/checkout/checkout.ts` ← `src/index.ts` |
| `test/checkout.test.ts` | 3 | graph | `src/lib/legacy-tax.ts` ← `src/cart/cart.ts` ← `src/checkout/checkout.ts` ← `test/checkout.test.ts` |

## Suggested tests (not executed)

| Test file | Why | Provenance |
|---|---|---|
| `src/cart/cart.test.ts` | imports-affected-module | graph |
| `test/checkout.test.ts` | imports-affected-module | graph |

## Limitations and unknowns

- `external-packages-not-analyzed` — Imports of npm packages and Node built-ins are not followed; changes inside dependencies are out of scope.
- `semantic-analysis-not-performed` — ChangeLens analyzes module-level imports and diff lines. It does not type-check, evaluate behavior or prove compatibility.
- `tests-not-executed` — Suggested tests are candidates only. ChangeLens never runs tests or package scripts.
- `unresolved-local-import` — Local imports that could not be resolved; their dependents may be missing. Examples: `src/cart/cart.ts → ../lib/legacy-tax`

<details><summary>Legend</summary>

- **observed**: read directly from `git diff`.
- **graph**: derived from imports resolved by dependency-cruiser.
- **inferred**: heuristic (path conventions, lexical patterns, workspace mapping).
- **confirmed by resolver**: a graph fact, e.g. an import that resolved in base no longer resolves in head.

</details>

<sub>ChangeLens 0.1.0-alpha.0 · schema 1.0 · dependency-cruiser 18.5.0 · TypeScript 6.0.3 · head graph 7 modules / 5 edges · offline, no telemetry</sub>

<sub>Built by EnWithAI · Part of CrewPE Engineering Commons · [crewpe.ai](https://crewpe.ai)</sub>
