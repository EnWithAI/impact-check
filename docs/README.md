# Impact Check documentation

| Document                                                         | What it covers                                                                                |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [PRD.md](PRD.md)                                                 | Problem, users, scope and non-goals of the alpha                                              |
| [CLI.md](CLI.md)                                                 | Commands, options, exit codes, uncommitted-change semantics, informational vs blocking checks |
| [CONFIG.md](CONFIG.md)                                           | `.impact-check.json` fields, conventions and policy                                           |
| [RULES.md](RULES.md)                                             | Analyzers, rules, finding status and recommended human actions                                |
| [ACTION.md](ACTION.md)                                           | GitHub Action inputs/outputs, permissions, fork behavior, remote test status                  |
| [ARCHITECTURE.md](ARCHITECTURE.md)                               | Module layout and data flow                                                                   |
| [CONTEXT_CONTRACT.md](CONTEXT_CONTRACT.md)                       | What context is read and ignored, what reports contain, guidance for humans and AI reviewers  |
| [THREAT_MODEL.md](THREAT_MODEL.md)                               | Threats, mitigations, misuse cases and residual risks                                         |
| [VERIFICATION_MATRIX.md](VERIFICATION_MATRIX.md)                 | Requirement → test → status                                                                   |
| [ACCEPTANCE.md](ACCEPTANCE.md)                                   | Acceptance scenarios and gates                                                                |
| [GOOGLE_SDLC_DELTA.md](GOOGLE_SDLC_DELTA.md)                     | Gap analysis against the SDLC addendum; schema 1.0 → 2.0 mapping                              |
| [RELEASE_NOTES_0.2.0-alpha.0.md](RELEASE_NOTES_0.2.0-alpha.0.md) | Draft release notes (current)                                                                 |
| [evidence/](evidence/)                                           | Recorded verification artifacts (e.g. the red run before implementation)                      |

The report contract itself is [`../schema/impact-check-report.schema.json`](../schema/impact-check-report.schema.json).

Naming: Impact Check was developed under the working name _ChangeLens_. Its planned siblings are **Spec Check**
(formerly SpecGuard) and **Outcome Check** (formerly AgentScore). _Check the spec. Check the impact. Check the outcome._
