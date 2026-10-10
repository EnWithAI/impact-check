# Contributing to Impact Check

Thanks for helping! Impact Check aims to stay **small, deterministic and honest** about what it knows.

## Ground rules

- Every new finding must carry evidence, a provenance (`observed` / `graph` / `inferred`) and `isHeuristic`.
  Prefer adding a coverage limitation over guessing.
- No network access, telemetry, code execution of analyzed repositories, or new runtime dependencies without
  discussion in an issue first.
- Fixtures must be **synthetic**. Never commit real or client code, secrets or personal data.
- Report schema changes must bump `schema_version` and update `schema/` + `src/types.ts` together.
- **Rule or analyzer changes need regression fixtures first:** add or update an expectation in
  `test/acceptance/expected/`, watch it fail, then implement. Golden snapshot updates (`vitest -u`) must be reviewed
  in the PR diff, never accepted blindly.

## Development

```bash
npm ci --ignore-scripts
npm run check:all      # typecheck, lint, format check, build, tests with coverage
node scripts/license-audit.mjs
node scripts/generate-demo-output.mjs   # after changing report output; commit the updated samples
```

Tests create throwaway git repositories in your temp directory (see `test/helpers.ts`).

## Pull requests

- Keep PRs focused; include tests that assert behavior (not just coverage).
- Describe user-visible changes in `CHANGELOG.md` under "Unreleased".
- By contributing you agree your contribution is licensed under the MIT License.

## Licensing of contributions and attribution

- Contributions are accepted under this repository's MIT License, inbound = outbound. By opening a pull request you
  confirm you have the right to submit the work under that license.
- Do not paste code, text or diagrams from other projects or publications. If third-party material is genuinely
  needed, open an issue first; it must keep its original license notice and be listed in [NOTICE.md](NOTICE.md).
- New source files start with `// SPDX-License-Identifier: MIT` (or `#` for YAML and shell).
- Do not add framework (CLEAR/TRACE) or product (CrewPE) claims unless
  [commons-provenance.yaml](commons-provenance.yaml) records an evidenced relationship. See
  [ATTRIBUTION.md](ATTRIBUTION.md).
- AI-assisted contributions are welcome. You are responsible for reviewing them and for their licensing; mention
  significant AI assistance in the PR description.

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
