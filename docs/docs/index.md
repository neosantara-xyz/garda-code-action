# Garda Code Action

Garda Code Action is a Neosantara-first open-source pull request agent. It can review changes, describe pull requests, answer questions, suggest improvements, update changelogs, generate labels, and add documentation.

## Configuration

Use `.garda.toml` in the repository root.

```toml
[config]
ai_handler = "neosantara"
model = "grok-4.1-fast-non-reasoning"

[neosantara]
base_url = "https://api.neosantara.xyz/v1"
```

## GitHub Action

```yaml
- uses: neosantara-xyz/garda-code-action@main
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    NEOSANTARA_API_KEY: ${{ secrets.NEOSANTARA_API_KEY }}
    GARDA_AI_HANDLER: neosantara
```

## Commands

- `/review`
- `/describe`
- `/improve`
- `/ask <question>`
- `/update_changelog`
- `/add_docs`
- `/generate_labels`
- `/help`
