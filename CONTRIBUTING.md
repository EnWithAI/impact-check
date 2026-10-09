# Contributing to ChangeLens

Thanks for helping! ChangeLens aims to stay **small, deterministic and honest** about what it knows.

## Ground rules

- Every new finding must carry evidence, a provenance (`observed` / `graph` / `inferred`) and `isHeuristic`.
  Prefer adding a coverage limitation over guessing.
- No network access, telemetry, code execution of analyzed repositories, or new runtime dependencies without
  discussion in an issue first.
- Fixtures must be **synthetic**. Never commit real or client code, secrets or personal data.
- Report schema changes must bump `schemaVersion` and update `schema/` + `src/types.ts` together.

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

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
