# Acceptance scenarios (map to PHASE_GATES "Acceptance tests for ChangeLens alpha")

| ID  | Scenario                                                                                 | Automated test                                         |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| A   | `--help`, `--version`, all flags work with no network/API keys                           | `test/cli.test.ts`                                     |
| B   | Changing a utility reports the file and its actual reverse dependents, no invented edges | `test/analyze.basic.test.ts`                           |
| C   | Changing an unrelated file yields no fabricated affected modules                         | `test/analyze.basic.test.ts`                           |
| D   | Public API / migration change reported as a candidate risk, not a proven break           | `test/rules.test.ts`                                   |
| E   | `--format json` validates against the schema and retains provenance                      | `test/schema.test.ts`                                  |
| F   | Markdown escapes crafted content and shows known unknowns                                | `test/markdown.test.ts`, `test/edge-cases.test.ts`     |
| G   | Diff edge cases deterministic; missing base ref → useful error                           | `test/edge-cases.test.ts`, `test/determinism.test.ts`  |
| H   | No package scripts, inference, telemetry or upload                                       | `test/security.test.ts`                                |
| I   | Fresh setup, typecheck, lint, test, build, tarball inspected                             | `progress/TEST_EVIDENCE.md`, `test/quickstart.test.ts` |
| J   | Minimal-permission Action produces a safe artifact or documents limits                   | `test/action.test.ts`, `docs/ACTION.md`                |
