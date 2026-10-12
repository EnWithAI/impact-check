# Impact Check

**Evidence-backed change-impact reports for JavaScript/TypeScript pull requests — offline, deterministic, and it never runs your code.**

Impact Check answers three questions about a change: _what might it affect, how do we know, and what still needs human verification?_ It compares a base ref to your branch (or working tree) and tells a reviewer:

- which files changed (added / modified / deleted / renamed / binary, staged / unstaged / untracked);
- which modules **depend on** them, with the shortest import chain as evidence (reverse-dependency "blast radius");
- which imports are **confirmed broken** — a deleted module still imported, or a removed export still imported by name (parser-verified);
- which changes **might** matter — exported declarations, package entry points and manifests, migrations, API contracts, CI/config, auth/crypto code — clearly labelled as heuristics;
- which tests are candidates to run (it never claims to have run them);
- what it could **not** analyze (dynamic imports, unresolved aliases, unsupported files, truncation, …).

Every finding carries a `status` — `verified_static_fact`, `hypothesis` or `unknown` — plus evidence (path, line range, commit), a provenance (`observed` git diff / `graph` resolver-parser / `inferred` heuristic) and a `recommended_human_action`. There is no opaque risk score and no percentage confidence.

> Formerly developed under the working name _ChangeLens_.
>
> Status: **early release** (`0.2.0`, pre-1.0, report schema 2.0). Published on npm as [`@enwithai/impact-check`](https://www.npmjs.com/package/@enwithai/impact-check); see [Install](#install).

## 60-second demo

Requires Node.js 22, 24 or ≥ 26 and git.

```bash
git clone https://github.com/enwithai/impact-check.git impact-check && cd impact-check
npm ci --ignore-scripts && npm run build
node examples/demo/create-demo.mjs /tmp/impact-check-demo   # synthetic repo with a feature branch
node dist/cli/main.js analyze --cwd /tmp/impact-check-demo --base main
```

The output is a Markdown report like [`examples/demo/output/sample-report.md`](examples/demo/output/sample-report.md)
(JSON: [`sample-report.json`](examples/demo/output/sample-report.json)). An excerpt:

```text
### HIGH · Import of deleted module no longer resolves: src/lib/legacy-tax.ts
`broken-import` · verified static fact · confidence high · provenance graph (resolver/parser)
- `src/lib/legacy-tax.ts` (base) — deleted
- `src/cart/cart.ts:2` (head) — imports "../lib/legacy-tax" (no longer resolves)

### MEDIUM · Potential public interface change in src/lib/money.ts: formatCents
`export-surface-changed` · hypothesis · confidence medium · provenance inferred (heuristic)
- `src/lib/money.ts:1` (head) — signature lines changed: function formatCents
```

The demo commits use fixed dates, so you get byte-identical output (apart from `generatedAt` in JSON).

## Install

```bash
npm install --save-dev --ignore-scripts @enwithai/impact-check
npx impact-check --help
```

To build from source instead:
`git clone https://github.com/enwithai/impact-check.git && cd impact-check && npm ci --ignore-scripts && npm run build`.

Uninstall with `npm uninstall @enwithai/impact-check`. Impact Check writes nothing outside the report files you ask
for (and private temp directories it deletes after each run). No account, token, telemetry or network access.

## Usage

```bash
impact-check analyze --base main                       # working tree (incl. staged, unstaged, untracked) vs main
impact-check analyze --base main --head HEAD           # committed HEAD only; uncommitted changes reported as excluded
impact-check analyze --base main --head HEAD --format json --output impact-check-report.json
impact-check check   --base main --head HEAD --config .impact-check.json   # exit 4 when the policy fails
impact-check render  --input impact-check-report.json    # re-render a saved JSON report
impact-check schema                                    # print the report JSON Schema
```

- Comparison uses **merge-base** semantics by default (like a GitHub PR); `--diff-mode direct` compares base directly.
- Exit codes: `0` ok · `1` internal error · `2` usage/config error · `3` git/repository error · `4` policy failure.
  `--on-error pass` makes tool/git errors non-blocking (fail-open, with a warning); usage errors and policy failures are never masked.
- `analyze` is informational; `check` is a policy signal. Impact Check never approves or merges anything.
- Full contract: [docs/CLI.md](docs/CLI.md). Configuration and policy: [docs/CONFIG.md](docs/CONFIG.md). Rules: [docs/RULES.md](docs/RULES.md).

## GitHub Action

Runs on `pull_request` with a read-only token, writes a job summary and a report artifact. Works for fork PRs and
never executes PR code. See [docs/ACTION.md](docs/ACTION.md) and
[examples/workflows/impact-check.yml](examples/workflows/impact-check.yml). Posting a PR comment is optional and uses a
separate, permission-scoped workflow ([example](examples/workflows/impact-check-comment.yml); not yet tested on GitHub).

## What Impact Check does not do (limitations)

- **No semantic analysis.** It reads module imports, export declarations (TypeScript parser, no type checker) and diff
  lines. "Potential public interface change" means lines in an exported signature changed, not that something broke.
  Single-line declarations count any edit on that line. `export *` makes export removal `unknown`.
- **No dependency graph → degraded mode.** Without JS/TS modules, only observed changes are listed (`analysis_mode: degraded`).
- Dynamic loading (`import(x)`, `require.context`, `import.meta.glob`, `eval`) and generated code are reported as limitations.
- **JS/TS only.** `.vue`, `.svelte`, `.astro` and other languages are listed but not parsed.
- **No installed packages are used.** Workspace-package imports are mapped to source entries by convention
  (`inferred`); imports of npm packages are not followed. Bundler-only aliases (webpack/vite) are not read, because
  reading them would mean executing JS config files.
- **One tsconfig** is used for `paths` aliases; other tsconfig `paths` are reported as ignored.
- **Non-literal dynamic imports** (`import(name)`) cannot be resolved and are listed as a limitation.
- **Tests are never run**; suggestions come from the import graph and naming conventions.
- Tested on macOS with Node 25 locally; CI targets Linux with Node 22/24/26. Windows is untested.

## How it works

1. `git` (spawned with argument arrays and hardened config) lists changes and changed lines.
2. The base and head states are materialized from git objects into a private temp directory — only JS/TS sources and
   `package.json`/`tsconfig` files with content; other files as empty placeholders. Symlinks and submodules are skipped.
3. [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) (MIT) builds the import graph through its
   public API; TypeScript 6.0 is used as its parser.
4. Reverse-dependency BFS, rules and test suggestions run on that data; reporters render JSON (schema 2.0) and
   escaped Markdown.

Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Threat model: [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Licensed under [MIT](LICENSE).

---

<sub>**Check the spec. Check the impact. Check the outcome.** Impact Check is one of three checks, with
[Spec Check](https://github.com/enwithai/spec-check) and [Outcome Check](https://github.com/enwithai/outcome-check).</sub>

<sub>An **EnWithAI Engineering Commons** initiative. Developed and maintained by EnWithAI Technologies, contributing to
open, verifiable and accountable AI-assisted software engineering. Part of the broader [CrewPE](https://crewpe.ai)
engineering ecosystem. Impact Check is independently usable and does not require CrewPE. Enterprise advisory and
transformation perspectives are supported through [NetworkGain Consulting](https://networkgain.com).
Attribution: [ATTRIBUTION.md](ATTRIBUTION.md) · Notices: [NOTICE.md](NOTICE.md) · Trademarks:
[TRADEMARKS.md](TRADEMARKS.md) · References: [REFERENCES.md](REFERENCES.md). Not affiliated with or endorsed by GitHub,
Anthropic or the dependency-cruiser maintainers.</sub>
