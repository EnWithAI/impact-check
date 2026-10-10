# Security policy

## Supported versions

Only the latest `0.x` alpha receives fixes.

## Reporting a vulnerability

Security contact: **Koushik Ramani** ([@aiwithrk](https://github.com/aiwithrk)), maintainer, EnWithAI Technologies ·
[hello@enwithai.com](mailto:hello@enwithai.com) (if you cannot use GitHub's private reporting).

Please **do not open a public issue**. Use GitHub's private vulnerability reporting ("Report a vulnerability" on the
Security tab of this repository). Include the Impact Check version, the command you ran
and a minimal synthetic reproduction — never real secrets or proprietary code. We aim to acknowledge within 5
business days.

## Security properties Impact Check is designed to keep

- It never executes repository code, package scripts, git hooks, diff drivers/textconv, fsmonitor or JS config files.
- It never uses the network (git lazy fetch is disabled) and has no telemetry.
- It never writes into the analyzed repository, except the report file you request with `--output`.
- Reports contain paths, line numbers, export _names_, import specifiers and manifest _field names_ — never file
  contents or values. Token-like strings are redacted. Markdown output escapes repository-controlled text.
- The GitHub Action runs under `pull_request` with read-only permissions and reads its policy config from the base commit.

A violation of any of these is a security bug. See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for the threat model
and residual risks (e.g. parser denial-of-service on hostile input, your own local git config such as clean filters).
