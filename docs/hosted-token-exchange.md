# Hosted GitHub App token exchange

Claude Code Action can appear as the official Claude GitHub App because Anthropic runs a backend that exchanges a GitHub Actions OIDC token for a GitHub App installation token.

Garda supports the same pattern. The action ships the client-side hook, and Neosantara hosts the exchange service at `https://api.neosantara.xyz/github-app/token-exchange`. With it, Garda comments and commits appear as `garda-code[bot]` without you having to manage a GitHub App private key in every repository — the workflow only needs `id-token: write`.

## How it works

```text
GitHub Actions runner                Neosantara backend                 GitHub
  │  getIDToken(audience)                  │                               │
  │ ───────────────────────────────────▶  │                               │
  │  POST /github-app/token-exchange       │                               │
  │  Bearer <OIDC JWT>                      │  verify OIDC (JWKS, aud,      │
  │  { repository, run_id, ref, sha }       │  issuer, claim match)        │
  │                                         │  mint App JWT, find install  │
  │                                         │ ────────────────────────────▶│
  │                                         │  installation access token   │
  │                                         │  validate workflow runs on   │
  │                                         │  the repo default branch     │
  │  { token, expires_at }                  │ ◀──────────────────────────── │
  │ ◀───────────────────────────────────  │                               │
```

## Workflow permissions

```yaml
permissions:
  id-token: write
  contents: read
  pull-requests: write
  issues: write
  actions: read
```

## Action inputs

```yaml
with:
  use_github_app_token_exchange: "true"
  github_app_token_exchange_url: "https://api.neosantara.xyz/github-app/token-exchange"
  github_app_token_exchange_audience: "garda-code-action"
```

## Full workflow example

```yaml
name: Garda Review (hosted token exchange)

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
  issue_comment:
    types: [created]

permissions:
  id-token: write # required to request the OIDC token
  contents: read
  pull-requests: write
  issues: write
  actions: read

jobs:
  garda:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: neosantara-xyz/garda-code-action@v1
        with:
          use_github_app_token_exchange: "true"
          github_app_token_exchange_url: "https://api.neosantara.xyz/github-app/token-exchange"
          github_app_token_exchange_audience: "garda-code-action"
          trigger_phrase: "@garda"
          mode: "auto"
        env:
          NEOSANTARA_API_KEY: ${{ secrets.NEOSANTARA_API_KEY }}
```

No `GARDA_APP_PRIVATE_KEY` secret is needed — the private key lives only on the Neosantara backend.

## Expected exchange response

```json
{
  "token": "ghs_...",
  "expires_at": "2026-06-09T12:00:00Z"
}
```

## Server-side guarantees

The hosted service (Neosantara `routes/oidc.js`) enforces:

- OIDC token verification against GitHub's JWKS — issuer, audience, and RS256 signature;
- claim matching: the `repository`, `run_id`, `ref`, and `sha` in the request body must equal the verified OIDC claims (anti-tampering);
- **workflow trust**: the token is only issued when the OIDC `job_workflow_ref` resolves to the repository's default branch, so a malicious PR cannot mint a token for an unreviewed workflow. If validation fails, the minted installation token is immediately revoked (fail-closed);
- minimum-scope installation tokens with a short `expires_at`.

## Prerequisite: install the Garda GitHub App

The backend can only mint a token for repositories where the Garda Code GitHub App is installed, and it must be configured with `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY`. If the app is not installed on the target repository, the exchange returns `installation_not_found`.

If you prefer to manage the key yourself instead of using the hosted service, use `actions/create-github-app-token` in the workflow — see [`setup-github-app.md`](setup-github-app.md).
