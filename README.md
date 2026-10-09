# ChangeLens

**Evidence-backed change-impact reports for JavaScript/TypeScript pull requests — offline, deterministic, and it never runs your code.**

ChangeLens compares a base ref to your branch (or working tree) and tells a reviewer:

- which files changed (added / modified / deleted / renamed / binary, staged / unstaged / untracked);
- which modules **depend on** them, with the shortest import chain as evidence (reverse-dependency "blast radius");
- which imports are **confirmed broken** (they resolved in base, they don't in head);
- which changes **might** matter — exported declarations, package entry points and manifests, migrations, API contracts, CI/config, auth/crypto code — clearly labelled as heuristics;
- which tests are candidates to run (it never claims to have run them);
- what it could **not** analyze (dynamic imports, unresolved aliases, unsupported files, truncation, …).

Every item says where it came from: `observed` (git diff), `graph` (resolved import) or `inferred` (heuristic). There is no opaque risk score.

> Status: **alpha** (`0.1.0-alpha.0`). Not yet published to npm; see [Install](#install).

## 60-second demo

Requires Node.js 22, 24 or ≥ 26 and git.

```bash
git clone <this repository> changelens && cd changelens
npm ci --ignore-scripts && npm run build
node examples/demo/create-demo.mjs /tmp/changelens-demo   # synthetic repo with a feature branch
node dist/cli/main.js analyze --cwd /tmp/changelens-demo --base main
```

The output is a Markdown report like [`examples/demo/output/sample-report.md`](examples/demo/output/sample-report.md)
(JSON: [`sample-report.json`](examples/demo/output/sample-report.json)). An excerpt:

```text
### HIGH · Import of deleted module no longer resolves: src/lib/legacy-tax.ts
`broken-import` · confirmed by resolver · confidence high · provenance graph (resolved import)
- `src/lib/legacy-tax.ts` (base) — deleted
- `src/cart/cart.ts:2` (head) — imports "../lib/legacy-tax" (no longer resolves)

### MEDIUM · Potential public interface change in src/lib/money.ts
`export-surface-changed` · heuristic · confidence medium · provenance inferred (heuristic)
- `src/lib/money.ts:1` (base) — modified: function formatCents
```

The demo commits use fixed dates, so you get byte-identical output (apart from `generatedAt` in JSON).

## Install

Until a release is published, install from a local build:

```bash
npm pack                                    # in this repository, after npm run build
npm install --save-dev --ignore-scripts ./enwithai-changelens-0.1.0-alpha.0.tgz   # in your project
npx changelens --help
```

Uninstall with `npm uninstall @enwithai/changelens`. ChangeLens writes nothing outside the report files you ask
for (and private temp directories it deletes after each run). No account, token, telemetry or network access.

## Usage

```bash
changelens analyze --base main                       # working tree (incl. staged, unstaged, untracked) vs main
changelens analyze --base main --head HEAD           # committed HEAD only; uncommitted changes reported as excluded
changelens analyze --base main --head HEAD --format json --output changelens-report.json
changelens check   --base main --head HEAD --config .changelens.json   # exit 4 when the policy fails
changelens render  --input changelens-report.json    # re-render a saved JSON report
changelens schema                                    # print the report JSON Schema
```

- Comparison uses **merge-base** semantics by default (like a GitHub PR); `--diff-mode direct` compares base directly.
- Exit codes: `0` ok · `1` internal error · `2` usage/config error · `3` git/repository error · `4` policy failure.
- Full contract: [docs/CLI.md](docs/CLI.md). Configuration and policy: [docs/CONFIG.md](docs/CONFIG.md). Rules: [docs/RULES.md](docs/RULES.md).

## GitHub Action

Runs on `pull_request` with a read-only token, writes a job summary and a report artifact. Works for fork PRs and
never executes PR code. See [docs/ACTION.md](docs/ACTION.md) and
[examples/workflows/changelens.yml](examples/workflows/changelens.yml). Posting a PR comment is optional and uses a
separate, permission-scoped workflow ([example](examples/workflows/changelens-comment.yml); untested remotely in alpha).

## What ChangeLens does not do (limitations)

- **No semantic analysis.** It reads module imports and diff lines; it does not type-check or prove (in)compatibility.
  "Potential public interface change" means exported declarations changed, not that something broke.
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
4. Reverse-dependency BFS, rules and test suggestions run on that data; reporters render JSON (schema 1.0) and
   escaped Markdown.

Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Threat model: [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Licensed under [MIT](LICENSE).

---

<sub>Built by EnWithAI · Part of CrewPE Engineering Commons · [crewpe.ai](https://crewpe.ai) · Enterprise advisory: [NetworkGain](https://networkgain.com). Not affiliated with or endorsed by GitHub, Anthropic or the dependency-cruiser maintainers.</sub>
