# References

Sources that shaped Impact Check. Dependencies we _run_ are in [ATTRIBUTION.md](ATTRIBUTION.md); this file lists
_ideas and specifications_ we used. Listing a source does not imply its authors endorse Impact Check or are affiliated
with it. No text, diagrams or tables are reproduced.

## Research and practice

### The New SDLC With Vibe Coding: From ad-hoc prompting to Agentic Engineering

- **Authors / publisher:** Addy Osmani, Shubham Saboo, Sokratis Kartakis; Google (course material for Google's
  AI Agents Intensive on Kaggle).
- **Date:** 2026. The exact month is unconfirmed: secondary sources say May or June 2026.
- **Verification:** **the original document was not retrieved.** Title, authors and context are corroborated only by
  secondary commentary (for example a DEV Community explainer and several blog summaries).
- **What we took from it, via EnWithAI's internal SDLC addendum:** the framing that specification, context and
  verification become the scarce resources as AI makes implementation cheaper.
- **Our interpretation (EnWithAI's own engineering proposals, not Google's):** ten engineering invariants, among them
  spec-first, verification-first fixtures, evidence with a tri-state `status`, explicit fail-open/fail-closed, model
  independence and untrusted-input handling. Also Impact Check's schema 2.0 and acceptance fixtures A1–A8. See
  [docs/GOOGLE_SDLC_DELTA.md](docs/GOOGLE_SDLC_DELTA.md).
- **No quantitative claims** from the paper or its commentary are used.
- **Commentary not read:** a user-provided Level Up Coding article by Rahul Gite discussing the paper informed the
  internal addendum. Impact Check's implementers did not read it.

## Specifications and upstream projects

| Project                                                              | Version / commit    | License | What we used                                                                                                           |
| -------------------------------------------------------------------- | ------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------- |
| [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) | v18.5.0 (`0e26935`) | MIT     | Public API and documented JSON output; its `--affected` feature informed our decision not to re-implement reachability |
| [GitHub Actions](https://docs.github.com/actions) documentation      | 2026                | —       | Event and permission semantics (`pull_request` vs `pull_request_target`, `GITHUB_TOKEN` scopes, pinning by commit SHA) |
| [JSON Schema](https://json-schema.org)                               | draft 2020-12       | —       | Report schema                                                                                                          |
| [SPDX License List](https://spdx.org/licenses/)                      | —                   | —       | License identifiers                                                                                                    |

## Surveyed, not used

| Project                                                   | Why it was reviewed                                                   |
| --------------------------------------------------------- | --------------------------------------------------------------------- |
| madge, skott, Nx `affected`, Turborepo `--affected`, knip | Overlap analysis for dependency graphs and affected-project detection |
| `changelens` on npm (BUSL-1.1)                            | Name collision check only; its source was deliberately not inspected  |
