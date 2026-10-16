# Architecture

```
cli/run.ts graph ──► graph/export.ts  snapshot + graph.ts → graph schema 1.0 document (no diff)

cli/run.ts ─┐                                     action/run.ts ─┐   (both call the same pipeline)
            ▼                                                     ▼
       analysis/analyze.ts  ── orchestrates one run, assembles the schema 2.0 report
            │
            ├─ git/exec.ts        hardened git spawn (argument arrays, safe -c config, no lazy fetch, caps)
            ├─ git/repo.ts        refs, merge base, diffs, working-tree state, batched object reads
            ├─ snapshot/          private temp copy of base/head: code files with content, others as placeholders
            ├─ graph/graph.ts     dependency-cruiser cruise() → ModuleGraph (deps, rdeps, unresolved, external)
            │    ├─ workspaces.ts  package discovery, inferred cross-package edges
            │    └─ lexical.ts     dynamic-loading scans, specifier line lookup
            ├─ analyzers/
            │    ├─ exports.ts     TypeScript-parser export sets, signature regions, imported names
            │    ├─ contract.ts    OpenAPI/AsyncAPI parse (yaml), local $ref resolution, structural base→head diff
            │    ├─ context.ts     languages, module type, workspace tools, test frameworks
            │    └─ generated.ts   generated-code detection
            ├─ analysis/impact.ts reverse BFS: distance, shortest `via` chain, changed roots
            ├─ rules/rules.ts     findings: status, severity, evidence, recommended human action
            ├─ analysis/tests.ts  test candidates (never executed)
            └─ analysis/limitations.ts  coverage limitations
       report/ json.ts · markdown.ts (escape.ts, redact.ts) · validate.ts (render)      policy.ts (check)
```

## Data flow

1. **Revisions:** refs are validated (`validateRef`) and resolved with `rev-parse --verify --end-of-options`; the merge base is computed.
2. **Changes:** three diffs in parallel (`--name-status -z`, `--numstat -z`, `-U0`) with `--no-ext-diff --no-textconv`. In working-tree mode, staged, unstaged, untracked and unmerged lists are collected too.
3. **Snapshots:** head (and base, when JS/TS modules were deleted or renamed). Analyzable files get content; everything else becomes an empty placeholder so imports of JSON or assets still resolve.
4. **Graph:** `cruise(["."], { baseDir: snapshot, tsPreCompilationDeps: true, tsConfig })`. Unresolved bare specifiers are mapped to workspace packages (inferred) or classified as external.
5. **Analyzers and rules:** export sets of base and head (batched base reads), the contract diff of changed OpenAPI/AsyncAPI files (read from git objects or the working tree, not from the snapshot), impact BFS, rules, test candidates and limitations. These are pure functions over the data above.
6. **Evidence commits:** base-side evidence → merge base (or base); head-side → head commit (null in worktree mode).
7. **Redaction** over every string, then JSON or escaped Markdown rendering.

## Design choices

See `progress/DECISIONS.md` in the EnWithAI Engineering Commons internal workspace. Key points:

- Snapshots instead of in-place analysis, so there's no `node_modules` influence and no repository mutation.
- TypeScript 6.0.x is pinned, because dependency-cruiser 18.5 supports `typescript < 7` and TS 7 has no JS compiler API.
- Tri-state finding status, with no numeric score.
- Deterministic output: sorted arrays, content-hash IDs, and normalized run metadata.
