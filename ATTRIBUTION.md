# Attribution and provenance

## Publisher

- **Project:** Impact Check (`@enwithai/impact-check`), formerly developed under the working name ChangeLens.
- **Commons:** EnWithAI Engineering Commons. Philosophy: _change impact should be evidence-based, explainable and
  reviewable._
- **Copyright holder:** EnWithAI Technologies (as stated in [LICENSE](LICENSE)).
- **License:** MIT. It applies to all code, documentation, schemas and examples in this repository.
- **Maintainer:** Koushik Ramani ([@aiwithrk](https://github.com/aiwithrk)), EnWithAI Technologies.
- **Security issues:** see [SECURITY.md](SECURITY.md).

## Development provenance

Impact Check was written for this repository and contains no vendored third-party source code. It was developed
with substantial AI assistance (Claude Code). Commits carry a `Co-Authored-By` trailer, and changes were directed
and accepted by the project's human sponsor. Test fixtures and demo repositories are synthetic.

## Built on

| Upstream                                                                               | Version        | License    | How Impact Check uses it                                                                                                                                                                       |
| -------------------------------------------------------------------------------------- | -------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) by Sander Verweij | 18.5.0         | MIT        | Module resolution and dependency graph through its public `cruise()` API. Impact Check adds provenance-labelled findings, base-vs-head comparison, risk heuristics and test candidates on top. |
| [TypeScript](https://github.com/microsoft/TypeScript) by Microsoft                     | 6.0.3          | Apache-2.0 | Parser only (syntax trees for export analysis); no type checking.                                                                                                                              |
| [Node.js](https://nodejs.org)                                                          | 22 / 24 / ≥ 26 | MIT        | Runtime; `node:util.parseArgs` for the CLI.                                                                                                                                                    |
| [Git](https://git-scm.com)                                                             | ≥ 2.24         | GPL-2.0    | Invoked as an external program (not linked or distributed) to read repository history.                                                                                                         |

Development tools (Vitest, ESLint, typescript-eslint, Prettier, Ajv) are not distributed. Research and design
influences are in [REFERENCES.md](REFERENCES.md). Listing a project does not mean its maintainers endorse Impact
Check.

## Frameworks

| Framework | Owner                  | Relationship   | Note                                                                                                                                                                                                            |
| --------- | ---------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLEAR     | NetworkGain Consulting | `none`         | Impact Check uses no structured-reasoning methodology.                                                                                                                                                          |
| TRACE     | EnWithAI Technologies  | `not-assessed` | Impact Check reports evidence-linked findings (status, path, line range, commit, provenance), but whether this aligns with TRACE cannot be stated until the TRACE specification is published. No claim is made. |

## Ecosystem

Impact Check is independently usable. It has no dependency on CrewPE, any EnWithAI service or NetworkGain, and it
never uses the network. CrewPE is EnWithAI's enterprise engineering-lifecycle product. It could consume Impact Check's
versioned JSON report as change-impact evidence; no such integration exists today. NetworkGain Consulting offers
advisory and transformation services, and using Impact Check creates no obligation to engage them.

## Not affiliated

Impact Check is not affiliated with, endorsed by or certified by GitHub, Microsoft, Anthropic, Google or the
dependency-cruiser maintainers.
