# Garda Code Action

**Protect your code with Garda** — an AI-powered code review action for GitHub pull requests and issues, powered by the Neosantara Responses API.

Garda reviews your pull requests automatically, leaves precise inline comments on the exact lines that need attention, flags security and performance issues, and can even open one-click suggested fixes. Mention `@garda` in any comment to ask questions or request a focused review on demand. It runs entirely on your own GitHub runner.

This action follows the proven production shape of Claude Code Action — event orchestration, trigger validation, permission guards, progress comments, bounded tools, and buffered inline review comments — with the model layer served by Neosantara's OpenAI-compatible `/v1/responses` endpoint.

## Features

- 🔍 **Automatic PR Code Review** — Reviews every pull request on open, push, and ready-for-review, with no extra prompting required.
- 💬 **Precise Inline Comments** — Posts review comments on the exact diff lines, validated against the PR diff hunks so feedback always lands where it belongs.
- ✨ **One-Click Suggested Fixes** — Emits GitHub `suggestion` blocks so authors can apply Garda's proposed change with a single click.
- 🔒 **Security-Focused Review** — Dedicated `security` mode with false-positive filtering for input validation, authn/authz, and injection risks.
- ⚡ **Performance & Quality Insights** — Surfaces bottlenecks, edge cases, and maintainability concerns alongside correctness.
- 🗣️ **Multilingual Review** — Set `review_language` (e.g. `id` for Bahasa Indonesia, `en` for English) to get feedback in your team's language.
- 🤖 **`@garda` Mentions** — Ask questions or request a targeted review by mentioning `@garda` in a comment, including precise "fix this line" targeting from a review comment.
- 🛠️ **Optional Fix Mode** — When explicitly enabled, Garda can commit fixes via git or the GitHub API, with co-authorship trailers and fork/permission guards.
- 📊 **CI & Release Insight** — `ci-analysis` mode inspects CI job logs; `release-notes` mode summarizes changes for releases.
- 📋 **Sticky Progress Comment** — A single comment tracks review progress and ends with a glanceable completion summary and action bar.
- 🔌 **MCP Support** — Native Neosantara MCP connector (`server_url` in `.mcp.json`) plus local MCP servers, with optional `allowed_tools`/`disallowed_tools` policy filters.

### Under the hood

- Node 24 JavaScript action (`runs.using: node24`) with a stateful Neosantara Responses API conversation (`previous_response_id`)
- Human/bot, write-permission, and fork PR repository-mutation guards
- Trusted config restore from the PR base branch before the agent runs
- Sanitized PR diff and contextual comments; secrets and common tokens redacted from diff/tool output
- Bounded repository and GitHub tool loop with repeated/per-step tool-call guards and retry/rate-limit handling
- Model-based inline comment classifier with heuristic fallback; batch PR review posting with per-comment fallback
- GitHub user-attachment image context for multimodal review
- `fallback_model` for automatic retry when the primary model is unavailable (supports multiple models tried in order)
- TOCTOU body-safety guard, secret/build/lock files ignored by default, fail-fast config validation
- Execution transcript output (`execution_file`), empty issue-fix branch cleanup, dry run support, and a local event simulator

## Quickstart

Garda runs as the **Garda Code GitHub App**, so its reviews appear as `garda-code[bot]`. Three steps:

1. **Install the app** on your repository or organization: **[github.com/apps/garda-code](https://github.com/apps/garda-code)**
2. **Add your Neosantara API key** as a repository secret named `NEOSANTARA_API_KEY` ([how to add secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions)).
3. **Add the workflow** below to `.github/workflows/garda.yml`.

```yaml
name: Garda Review

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]

permissions:
  id-token: write # lets Garda mint its garda-code[bot] token
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
          trigger_phrase: "@garda"
          mode: "auto"
          review_language: "id"
          # Optional: override the model (defaults to gemini-3.5-flash)
          # model: "gemini-3.5-flash"
        env:
          NEOSANTARA_API_KEY: ${{ secrets.NEOSANTARA_API_KEY }}
```

That's it. With the app installed and `id-token: write` granted, Garda automatically obtains a `garda-code[bot]` token via Neosantara's hosted token exchange — no GitHub App private key to create, store, or rotate.

## Other setups

If you cannot install the official Garda app (for example, org policy blocks third-party apps), run Garda with the default `GITHUB_TOKEN` — no app at all. Comments appear as `github-actions[bot]`. See [`examples/garda-review-default-token.yml`](examples/garda-review-default-token.yml).

## Modes

- `auto`: automatic PR review on supported PR events; tag-triggered on comments.
- `review`: review-oriented behavior.
- `ask`: answer a specific GitHub comment request.
- `security`: security-focused review with false-positive filtering.
- `ci-analysis`: inspect CI status and job logs when available.
- `release-notes`: summarize changes for release notes.
- `fix`: enables write/commit tools only when `allow_fix: true`.

## Example workflows

Ready-to-use workflows live in [`examples/`](examples/):

| Workflow | What it does |
| --- | --- |
| [`garda-review.yml`](examples/garda-review.yml) | Recommended: install the Garda app and review as `garda-code[bot]` |
| [`garda-review-default-token.yml`](examples/garda-review-default-token.yml) | No app — uses the default `GITHUB_TOKEN` (comments as `github-actions[bot]`) |
| [`garda-review-comprehensive.yml`](examples/garda-review-comprehensive.yml) | In-depth review steered by `custom_instructions` (quality, security, performance, testing, docs) |
| [`garda-review-filtered-paths.yml`](examples/garda-review-filtered-paths.yml) | Review only when critical paths change (auth, payments, infra) |
| [`garda-security-review.yml`](examples/garda-security-review.yml) | Security-focused review triggered by `@garda security` |
| [`garda-readonly-locked-tools.yml`](examples/garda-readonly-locked-tools.yml) | Read-only review with a locked-down tool policy |
| [`garda-fix.yml`](examples/garda-fix.yml) | Fix mode — Garda commits suggested changes when you comment `@garda fix` |

## Local simulation

Run trigger/mode/fork-policy checks without pushing to GitHub:

```bash
npm run build
npm run simulate -- fixtures/events/issue_comment_trigger.json
npm run simulate -- fixtures/events/fork_pull_request.json --mode fix --allow-fix true
```

The simulator is offline and dry-run only. It validates event parsing, trigger detection, execution mode, extracted request, and fork/fix guard behavior.

## Security defaults

- Bot actors are blocked unless listed in `allowed_bots`.
- Non-write users are blocked unless listed in `allowed_non_write_users`.
- Fix tools are disabled unless `allow_fix=true`, `mode=fix`, and the PR is not from a fork.
- Sensitive Garda/Neosantara/MCP/git config is restored from the PR base branch before the agent runs.
- Secrets and common tokens are redacted from diff/tool output.
- Inline comments are buffered and path-validated (against the PR diff hunks) before posting.
- Generated/build/lock files and secret files (`.env`, `*.pem`, `*.key`, `.npmrc`, etc.) are ignored by default, so they are never fed to the model or written by fix tools. Extra patterns can be added via the `ignore` input.
- Entity body/title are TOCTOU-guarded: if the issue/PR was edited at or after the trigger time, the frozen webhook payload version is used instead.
- `display_report=false` by default so model-authored content is not written to the GitHub Step Summary unless explicitly enabled.
- Configuration is validated at startup (fail-fast) for `NEOSANTARA_API_KEY`, `github_token`, `model`, and runtime bounds.

## MCP servers

Garda supports two MCP server styles via `.mcp.json` in the repository root:

```json
{
  "mcpServers": {
    "abmeter": {
      "server_url": "https://mcp.abmeter.ai",
      "authorization_token": "Bearer <token>",
      "require_approval": "never"
    },
    "local-tool": {
      "command": "npx",
      "args": ["-y", "some-local-mcp-server"]
    }
  }
}
```

- Servers with `server_url` use the **native Neosantara MCP connector** — they are passed to the Responses API as `type: "mcp"` tools and executed by the Neosantara backend. `authorization_token` is forwarded to the upstream MCP server.
- Servers with `command` are spawned locally and their tools are registered into the agent tool loop.

## Neosantara API

Set `NEOSANTARA_API_KEY` as a repository secret. The default base URL is:

```txt
https://api.neosantara.xyz/v1
```

The runner uses `responses.create` with `store: true` and continues tool turns using `previous_response_id`. It retries transient 408/409/425/429/5xx errors and honors `Retry-After` when present. Inline comment classification can also use the Responses API through `inline_classifier_mode: model`.

## Bot identity

Garda's reviews appear as `garda-code[bot]` when the official Garda Code app is installed and the workflow grants `id-token: write` — Garda mints the bot token automatically via Neosantara's hosted token exchange, with nothing else to configure. See the [Quickstart](#quickstart) and [`docs/hosted-token-exchange.md`](docs/hosted-token-exchange.md).

If you can't install the app, Garda falls back to the default `GITHUB_TOKEN` and comments appear as `github-actions[bot]`.

## Advanced parity options

```yaml
with:
  inline_classifier_mode: "model"
  min_inline_severity: "medium"
  enable_mcp_compat: "true"
  allowed_tools: |
    repo_*
    github_get_ci_status
    github_buffer_inline_comment
    github_update_tracking_comment
  disallowed_tools: |
    repo_write_file
    git_commit_files
  custom_instructions: "Prioritize correctness and security over style comments."
  max_runtime_seconds: "900"
  max_output_tokens: "8000" # cap model output per turn (cost/runaway guard)
  fallback_model: |
    claude-opus-4-6
    claude-sonnet-4-6
    # tried in order if the primary model is unavailable (503/404/422)
  commit_strategy: "github-api" # fix mode only
```

`commit_strategy: github-api` uses the GitHub Git Data API to create commits on the target branch. It avoids depending on git push credential state and is the closest action-local equivalent to Claude Code Action file-ops commits.

### Hosted token exchange

Garda can also obtain its GitHub App token via OIDC, so comments appear as `garda-code[bot]` without storing a private key in your repository. Neosantara hosts the exchange at `https://api.neosantara.xyz/github-app/token-exchange`, which verifies the OIDC token and only issues a scoped installation token when the workflow runs from the repository's default branch. Set `use_github_app_token_exchange: "true"` and `id-token: write`; see [`docs/hosted-token-exchange.md`](docs/hosted-token-exchange.md).

## Outputs

Important outputs:

- `execution_file`: local JSON transcript path for the run.
- `branch_name`: branch created/used by fix mode.
- `session_id`: final Neosantara Responses API response id.
- `comment_url`: tracking comment URL.

## Publishing

See [`docs/publish-action.md`](docs/publish-action.md). The repository must be public for GitHub Marketplace, and `action.yml` plus the bundled `dist/index.js` must be committed at the repository root.

## License

Licensed under the [Apache License 2.0](LICENSE).
