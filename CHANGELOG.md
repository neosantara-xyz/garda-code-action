# Changelog

All notable changes to Garda Code Action are documented here.

## [v1] - 2026-06-10

### Added

- **Hosted GitHub App token exchange** — Garda mints its `garda-code[bot]`
  token automatically via Neosantara's OIDC token exchange. No private key to
  manage. Auto-detects `id-token: write` and falls back to `GITHUB_TOKEN` when
  the app is not installed.
- **Multiple fallback models** — `fallback_model` accepts a comma/newline list
  tried in order when the primary model is unavailable (503/404/422).
- Product-first quickstart and example workflows.

### Changed

- Default model is now `gemini-3.5-flash` with a `claude-opus-4-6`,
  `claude-sonnet-4-6` fallback chain.
- Review loop now finishes reliably: the agent is given an explicit
  termination contract and a step budget, and is forced to return its report
  near the step limit instead of looping on read tools.

### Fixed

- Token-exchange backend now accepts `pull_request` workflow refs, so PR
  reviews from same-repo branches are no longer rejected.

### Security

- Token exchange validates that the calling workflow runs from the default
  branch or a pull-request ref, and revokes the minted token if validation
  fails (fail-closed).
