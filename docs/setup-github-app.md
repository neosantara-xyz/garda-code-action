# Setup GitHub App for Garda Code Action

A normal workflow token makes comments as `github-actions[bot]`. To make comments and commits appear as your own app, for example `garda-code[bot]` or `neosantara-ai[bot]`, run the action with a GitHub App installation token.

## Required app permissions

Review-only mode:

- Metadata: read
- Contents: read
- Issues: read & write
- Pull requests: read & write
- Actions: read

Fix mode additionally needs:

- Contents: read & write

Do not grant `Workflows: write` unless you have a separate, audited use case.

## Repository variables and secrets

Add these in the target repository or organization:

- Variable: `GARDA_APP_CLIENT_ID`
- Secret: `GARDA_APP_PRIVATE_KEY`
- Secret: `NEOSANTARA_API_KEY`

`GARDA_APP_PRIVATE_KEY` is the full `.pem` content from the GitHub App settings.

## Get bot id for commits

`bot_id` is only needed for fix mode commits. You can get it in workflow with `gh api`:

```yaml
- name: Get Garda bot user id
  id: bot-user
  run: echo "id=$(gh api '/users/${{ steps.app-token.outputs.app-slug }}[bot]' --jq .id)" >> "$GITHUB_OUTPUT"
  env:
    GH_TOKEN: ${{ steps.app-token.outputs.token }}
```

Then pass:

```yaml
bot_id: ${{ steps.bot-user.outputs.id }}
bot_name: ${{ steps.app-token.outputs.app-slug }}[bot]
```

## Why this is not OpenReview-style yet

This repository is a GitHub Action. It does not need a hosted webhook server. OpenReview-style bots run as a GitHub App webhook service, often on Vercel or another backend. That model is better for a SaaS bot later, but the action-first setup is simpler to publish and install.
