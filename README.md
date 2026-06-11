# Garda Code Action

Garda Code Action is a Neosantara-first automated pull request agent for review, description, question answering, changelog updates, docs generation, labels, and code improvement workflows.

This build uses:

- Python package: `garda`
- Repository config: `.garda.toml`
- CLI entrypoint: `garda-code-action`
- Default AI handler: `neosantara`

## Neosantara setup

Required secret:

```bash
export NEOSANTARA_API_KEY="..."
```

Default config example:

```toml
[config]
ai_handler = "neosantara"
model = "grok-4.1-fast-non-reasoning"
fallback_models = ["gemini-3.5-flash"]

[neosantara]
base_url = "https://api.neosantara.xyz/v1"
```

## GitHub Action

Create `.github/workflows/garda-code-action.yml`:

```yaml
name: Garda Code Action

on:
  pull_request:
    types: [opened, reopened, ready_for_review, synchronize]
  issue_comment:
    types: [created]
  workflow_dispatch:

permissions:
  contents: read
  issues: write
  pull-requests: write

jobs:
  garda_code_action:
    if: ${{ github.event.sender.type != 'Bot' }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run Garda Code Action
        uses: neosantara-xyz/garda-code-action@main
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NEOSANTARA_API_KEY: ${{ secrets.NEOSANTARA_API_KEY }}
          GARDA_AI_HANDLER: neosantara
          GITHUB_ACTION_CONFIG.AUTO_DESCRIBE: true
          GITHUB_ACTION_CONFIG.AUTO_REVIEW: true
          GITHUB_ACTION_CONFIG.AUTO_IMPROVE: true
```

## CLI usage

```bash
pip install garda-code-action
export NEOSANTARA_API_KEY="..."
garda-code-action --pr_url https://github.com/owner/repo/pull/123 review
```

Available PR comment commands:

```text
/review
/describe
/improve
/ask what does this PR change?
/update_changelog
/add_docs
/generate_labels
/help
```

## Provider options

LangChain and AWS-specific surfaces were removed for a lean Garda build. LiteLLM is intentionally kept as an optional fallback while Neosantara support in LiteLLM stabilizes.

Supported handlers in this build:

```toml
[config]
ai_handler = "neosantara" # default
# ai_handler = "agno"
# ai_handler = "any_llm"
# ai_handler = "litellm"
# ai_handler = "openai"
```

## What changed from upstream

- Rebranded user-facing surfaces to Garda Code Action by Neosantara.
- Renamed the upstream Python package namespace to `garda`.
- Renamed repository config to `.garda.toml` only.
- Added Neosantara, Agno, and Any-LLM handlers.
- Removed LangChain, AWS Secrets Manager, AWS CodeCommit, Lambda deployment, Bedrock configuration, and boto3.
- Kept core PR tools: review, describe, improve, ask, labels, changelog, docs, help, and provider integrations for GitHub/GitLab/Bitbucket/Azure/Gerrit/Gitea/local.

## Documentation

Project docs are in [`docs/docs`](docs/docs).

## Security

When using Garda Code Action with your own LLM provider key, code is sent directly to the configured provider. For the default Neosantara flow, set `NEOSANTARA_API_KEY` in your repository or deployment secrets.
