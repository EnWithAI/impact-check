# Architecture

```
cli/run.ts ──► analysis/analyze.ts ──► git/repo.ts (+ git/exec.ts: hardened spawn)
   │                 │                    changes, numstat, -U0 hunks, ls-tree, cat-file --batch
   │                 ├──► snapshot/snapshot.ts   private temp copy of base/head (no checkout, no symlinks)
   │                 ├──► graph/graph.ts         dependency-cruiser cruise() → ModuleGraph (deps, rdeps, unresolved)
   │                 │      ├─ graph/workspaces.ts  package.json packages → inferred cross-package edges
   │                 │      └─ graph/lexical.ts     non-literal import scan, specifier line lookup, export names
   │                 ├──► analysis/impact.ts     reverse BFS: distance, via chain, changed roots, counts
   │                 ├──► rules/rules.ts         findings with evidence/provenance/isHeuristic
   │                 ├──► analysis/tests.ts      candidate tests (never run)
   │                 └──► analysis/limitations.ts coverage limitations (sorted, capped)
   ├──► report/json.ts | report/markdown.ts (escape.ts, redact.ts) | report/validate.ts (render)
   └──► policy.ts (check)            action/run.ts → same pipeline for GitHub Actions
```

## Data flow

1. **Resolve refs** (`validateRef` + `rev-parse --verify --end-of-options`), compute merge base.
2. **Diff** three ways in parallel (`--name-status -z`, `--numstat -z`, `-U0`) with `--no-ext-diff --no-textconv`;
   in working-tree mode also staged/unstaged/untracked/unmerged lists.
3. **Snapshot** head (and base, only when JS/TS modules were deleted or renamed): analyzable files with content,
   everything else as empty placeholders so that `import data from "./x.json"` still resolves.
4. **Graph**: `cruise(["."], { baseDir: snapshot, tsPreCompilationDeps: true, tsConfig })`. Unresolved bare
   specifiers are mapped to workspace packages (inferred) or classified as external.
5. **Impact, rules, tests, limitations** are pure functions over the above; all output arrays are sorted and finding IDs
   are content hashes, so normalized output is deterministic.
6. **Redaction** runs over every string in the report before rendering.

## Design choices

See `progress/DECISIONS.md` in the CrewPE Engineering Commons workspace (D-010 … D-032). Key points: snapshots instead of
in-place analysis (no node_modules influence, no repo mutation); one non-heuristic finding class in alpha; no score.
