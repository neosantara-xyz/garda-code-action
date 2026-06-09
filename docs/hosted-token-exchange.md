# Hosted GitHub App token exchange

Claude Code Action can appear as the official Claude GitHub App because Anthropic runs a backend that exchanges a GitHub Actions OIDC token for a GitHub App installation token.

Garda Code Action v0.1.8 includes the client-side hook for the same pattern, but Neosantara still needs to host the exchange service.

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

The action will:

1. Request an OIDC token with `@actions/core.getIDToken(audience)`.
2. POST that token to the exchange URL.
3. Expect JSON containing `token` or `github_token`.
4. Use the returned token for all GitHub API calls.

## Expected exchange response

```json
{
  "token": "ghs_...",
  "expires_at": "2026-06-09T12:00:00Z"
}
```

## Server-side responsibilities

The hosted service must:

- validate the OIDC token issuer, audience, repository, ref, workflow, and run claims;
- map the repository/org to the installed Garda Code GitHub App installation;
- mint a scoped installation token with minimum permissions;
- reject fork/untrusted combinations unless explicitly allowed;
- audit log every exchange.

Without this backend, use `actions/create-github-app-token` in the workflow instead.
