# `impact-check graph` — module graph export (spec)

_Spec written before the implementation (design notes §7.1, decision D-081). Contract:
[`../schema/impact-check-graph.schema.json`](../schema/impact-check-graph.schema.json), graph schema 1.0, independent
of the report schema version._

```
impact-check graph [--format json] [--head <ref> | --worktree] [--cwd <dir>] [--tsconfig <file>] [--output <file>] [--quiet]
impact-check schema graph
```

Emits the JS/TS module graph of **one** revision, resolved by the same dependency-cruiser setup that `analyze` uses
(one resolver for every Commons tool, D-081). Other tools, such as the planned Architecture Check, read this file
instead of resolving imports themselves.

- Without `--head` the working tree is used (tracked and untracked, not ignored), like `analyze`. With `--head` the
  committed tree of that ref is used.
- `--format` accepts only `json` (the default). There is no Markdown rendering of the graph.
- No base ref is needed and no diff is computed. `--base`, `--diff-mode`, `--max-depth` and `--max-affected` are
  rejected as usage errors (exit 2).
- Exit codes are those of `analyze` (0, 1, 2, 3). `--on-error` applies.
- `impact-check schema graph` prints the graph JSON Schema; `impact-check schema` still prints the report schema.

## Content

| Field                  | Meaning                                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `modules[]`            | Every node: path, `language`, `kind` (as in `changed_files`, honoring `conventions.testPatterns`), innermost workspace `package`    |
| `edges[]`              | `from` → `to`, `provenance` (`graph` = resolver, `inferred` = workspace mapping), `type_only`, and each import `specifier` + `line` |
| `unresolved_imports[]` | Local imports that did not resolve (`from`, `specifier`, `line`)                                                                    |
| `external_imports[]`   | npm package and Node built-in imports, not followed (`from`, `specifier`, `line`)                                                   |
| `stats`                | Same counts as `run_metadata.head_graph` in the report                                                                              |
| `coverage_limitations` | Same codes as the report (`tsconfig-*`, `dynamic-module-loading`, `symlink-skipped`, `no-dependency-graph`, …)                      |

`line` is the first line of the importing file that contains the literal specifier in quotes, or `null`. All arrays are
sorted (`compareStrings`: by UTF-16 code unit). Strings are redacted like report strings. The output never contains file
contents. Determinism: identical except `run_metadata.generated_at` and `run_metadata.node_version`.

## Fixture

`test/graph.test.ts` (G1) builds a synthetic two-package workspace with a relative import, a workspace import
(inferred), a type-only import, an unresolved import and an npm import, and compares the output with
`test/expected/g1-graph.json`, written by hand before the command existed.
