# GitHub Action

## Recommended workflow

See [`examples/workflows/changelens.yml`](../examples/workflows/changelens.yml):

- trigger: `pull_request` (not `pull_request_target`);
- `permissions: contents: read` — no write scopes, no secrets;
- `actions/checkout` with `fetch-depth: 0` (the merge base must exist) and `persist-credentials: false`;
- all third-party actions pinned to full commit SHAs;
- outputs: job summary (Markdown, ≤ 60k chars) and `changelens-report/changelens-report.{json,md}` uploaded as an artifact.

Pin ChangeLens itself to a release **commit SHA**. Release tags contain the built `dist/`; the action installs its own
runtime dependencies from its lockfile with `npm ci --omit=dev --ignore-scripts` (this step contacts the npm
registry; the analysis itself does not use the network).

## Inputs

| Input                       | Default                    | Notes                                                                                                                      |
| --------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `base`                      | PR base SHA from the event | Required outside `pull_request` events.                                                                                    |
| `head`                      | `HEAD`                     | With the default checkout this is the PR merge commit; merge-base mode then yields exactly the PR's changes.               |
| `diff-mode`                 | `merge-base`               | or `direct`.                                                                                                               |
| `working-directory`         | `.`                        | Must stay inside the workspace.                                                                                            |
| `output-dir`                | `changelens-report`        | Relative path inside the workspace.                                                                                        |
| `config-source`             | `base`                     | `base` reads `.changelens.json` from the base commit so a PR cannot weaken its own policy; `head` or `none` also possible. |
| `config-path`               | `.changelens.json`         |                                                                                                                            |
| `fail-on-policy`            | `false`                    | `true` fails the step (exit 4) when the policy fails.                                                                      |
| `max-depth`, `max-affected` | config/defaults            |                                                                                                                            |

Outputs: `report-json`, `report-markdown`, `high-findings`, `affected-modules`, `policy` (`passed`/`failed`).

## Security notes

- Inputs reach the script only via `env:`; nothing user-controlled is interpolated into shell code.
- The action reads git objects and writes report files; it never runs PR code, package scripts or JS configs.
- **Fork PRs:** work the same way (read-only token). The job summary and artifact are visible to anyone who can see the run.
- **PR comments** need `pull-requests: write`, which fork PR runs never get. Use the separate
  [`changelens-comment.yml`](../examples/workflows/changelens-comment.yml) `workflow_run` template. It treats the
  artifact as untrusted: it re-renders it with a pinned ChangeLens release (`changelens render` validates structure and
  escapes all content) and finds the PR by matching the triggering run's head SHA and repository instead of trusting a
  number from the artifact. It lists up to 100 open PRs (one API page); repositories with more need pagination.
- API usage: the analysis job makes no GitHub API calls. The comment workflow makes 2–3 calls per run (far below GitHub's
  documented `GITHUB_TOKEN` rate limit of 1,000 requests/hour per repository; verify current limits for your plan). On API failure the comment step fails; the analysis
  result is unaffected.

## Test status (alpha)

| Test                                                                                                           | Status                                                          |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `runAction` with simulated event/env (`test/action.test.ts`)                                                   | **pass** (local)                                                |
| Composite steps executed locally with a copied action directory (`npm ci --omit=dev --ignore-scripts` + entry) | **pass** (local, see TEST_EVIDENCE)                             |
| Workflow lint: no `pull_request_target`, SHA pins, no `${{ }}` in `run:`, read-only permissions                | **pass**                                                        |
| Real GitHub-hosted run (`action-self-test` job in CI)                                                          | **NOT RUN** — no remote repository yet (requires user approval) |
| Fork-PR behavior on GitHub                                                                                     | **NOT RUN**                                                     |
| Comment workflow on GitHub                                                                                     | **NOT RUN**                                                     |

### Manual test plan for the first remote run (after approval)

1. Push the branch to a private test repository; open a PR from a branch → `CI / action-self-test` must pass and show a job summary.
2. Open a PR from a fork → same result; confirm no secrets are available and the token is read-only.
3. In the PR, change `.changelens.json` to `failOnSeverity: "none"` and delete an imported module; with `fail-on-policy: true` the job must still fail (base config wins).
4. Enable the comment workflow in a test repository; confirm one comment is created and then updated, and that a PR whose head SHA does not match receives no comment.
