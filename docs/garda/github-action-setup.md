# GitHub Action setup

Use this workflow in the repository you want Garda Code Action to review.

## 1. Add repository secret

Create a GitHub repository secret named `NEOSANTARA_API_KEY`.

Path in GitHub UI:

`Repository Settings -> Secrets and variables -> Actions -> New repository secret`

## 2. Add workflow

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

If you publish this fork under a different GitHub repository, replace `neosantara-xyz/garda-code-action@main` with your real `owner/repo@tag`.

## 3. Optional repository config

Create `.garda.toml` in the target repository:

```toml
[config]
ai_handler = "neosantara"
model = "grok-4.1-fast-non-reasoning"
fallback_models = ["gemini-3.5-flash"]

[neosantara]
base_url = "https://api.neosantara.xyz/v1"
```

Alternative native integrations:

```toml
[config]
ai_handler = "agno"
```

```toml
[config]
ai_handler = "any_llm"

[any_llm]
provider = "neosantara"
```

## 4. Manual commands

After the action is installed, comment on a PR with one of these commands:

```text
/review
/describe
/improve
/ask what does this PR change?
/update_changelog
/add_docs
```
