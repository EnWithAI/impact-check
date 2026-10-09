# Impact Check 0.2.0-alpha.0 (draft — not published)

Supersedes the unpublished 0.1.0-alpha.0 draft. Aligns Impact Check with spec-first, verification-first, harness-driven
engineering (CrewPE Google SDLC addendum).

**What might this change affect, how do we know, and what still needs human verification?**

- Every finding is a `verified_static_fact`, a `hypothesis` or `unknown`, with evidence (path, lines, commit) and a
  recommended human action. No scores, no percentages.
- New parser-based export analysis: removed or renamed exports that dependents still import are reported as verified
  static facts with the importing line; `export *` makes them `unknown` instead of guessing.
- Affected modules cite the exact import line that links them to the change.
- Degraded mode when there is no JS/TS graph; dynamic loading and generated code reported as limitations.
- Explicit fail-open/fail-closed behavior (`--on-error`, Action `on-error`); the Action never reads tokens or secrets.
- Report schema 2.0 (breaking vs the unpublished 1.0 draft; mapping in `docs/GOOGLE_SDLC_DELTA.md`).

Known limitations: static only; ESM named exports only; one tsconfig; Windows and GitHub-hosted runs untested.
