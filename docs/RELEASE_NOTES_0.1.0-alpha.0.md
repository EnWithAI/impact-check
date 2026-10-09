# ChangeLens 0.1.0-alpha.0 (draft release notes — not published)

First alpha of ChangeLens, a local-first change-impact analyzer for JavaScript/TypeScript pull requests.

**What you get**

- `changelens analyze` — Markdown or JSON report: changed files, reverse-dependency blast radius with import chains,
  confirmed broken imports, heuristic risk prompts (exports, package entries/manifests, migrations, API contracts,
  CI/config, auth/crypto), candidate tests, and an explicit list of limitations.
- `changelens check` — policy gate with a distinct exit code (4). By default it fails only on graph-confirmed findings.
- `changelens render` / `schema` — re-render saved reports; JSON Schema 1.0.
- A composite GitHub Action for `pull_request` with read-only permissions (job summary + artifact).

**Principles**: offline, deterministic, no telemetry, no account, never executes repository code; every item labelled
`observed`, `graph` or `inferred`.

**Known limitations**: no semantic/type analysis; JS/TS only; one tsconfig for `paths`; workspace edges inferred by
convention; bundler aliases not read; Windows untested; GitHub-hosted Action runs not yet verified.

Built on [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) (MIT) — not affiliated with or endorsed by its maintainers.
