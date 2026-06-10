# Garda Code Action

Production-grade GitHub automation powered by the Neosantara Responses API.

This action is intentionally modeled after the proven production shape of Claude Code Action: event orchestration, trigger validation, permission guards, progress comments, bounded tools, buffered inline review comments, and a stateful agent loop. The model layer is Neosantara, using the OpenAI-compatible `/v1/responses` endpoint with `previous_response_id`.

## Features

- Node 24 JavaScript action (`runs.using: node24`)
- Neosantara Responses API with stateful conversation
- `@garda` tag mode and workflow prompt agent mode
- Human/bot and write-permission guard
- Fork PR repository-mutation guard
- Trusted config restore from the PR base branch
- Sticky progress comment
- Sanitized PR diff and contextual comments
- Tool loop with bounded repository and GitHub tools
- Responses API retry/rate-limit handling
- Repeated tool-call and per-step tool-call guards
- Buffered inline comments that are validated before posting
- Model-based inline comment classifier with heuristic fallback
- Batch PR review posting with fallback to individual review comments
- GitHub user-attachment image context for multimodal review
- Empty issue-fix branch cleanup after runs with no committed changes
- Execution transcript output (`execution_file`) for debugging and audit trails
- Optional compact fix-request hints on inline comments
- Optional fix mode, disabled by default
- Git or GitHub API commit strategy for fix mode
- MCP-style compatibility aliases for Claude Code Action-like tool names
- Native Neosantara MCP connector support (`server_url` in `.mcp.json`) alongside local MCP servers
- Optional `allowed_tools` / `disallowed_tools` tool policy filters
- Trusted workflow `custom_instructions` support
- `max_runtime_seconds` wall-clock guard for the agent loop
- `fallback_model` for automatic retry when the primary model is unavailable (supports multiple models tried in order)
- GitHub suggestion blocks (` ```suggestion `) in inline review comments for one-click fixes
- Diff-hunk validation so inline comments only target lines present in the PR diff
- TOCTOU body-safety guard (uses webhook payload body if the entity was edited after the trigger)
- Prior PR review bodies included in context for fix-mode feedback cycles
- Trigger comment file/line/diff-hunk location surfaced for precise "@garda fix this" targeting
- Co-authorship trailer on commits (with username fallback)
- Executable-bit preservation and ref-update retry in GitHub API commit strategy
- Secret/build/lock files ignored by default (e.g. `.env`, `*.pem`, `node_modules`, lock files)
- Fail-fast config validation at startup
- Glanceable completion comment: `**Garda finished @user's task in Xm Ys**` with an inline action bar
- Optional hosted GitHub App token exchange hook using GitHub Actions OIDC
- Dry run support
- Local event simulator with fixtures

## Usage

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
      - uses: neosantara/garda-code-action@v1
        with:
          trigger_phrase: "@garda"
          mode: "auto"
          model: "grok-code-fast"
          review_language: "id"
        env:
          NEOSANTARA_API_KEY: ${{ secrets.NEOSANTARA_API_KEY }}
```

## Modes

- `auto`: automatic PR review on supported PR events; tag-triggered on comments.
- `review`: review-oriented behavior.
- `ask`: answer a specific GitHub comment request.
- `security`: security-focused review with false-positive filtering.
- `ci-analysis`: inspect CI status and job logs when available.
- `release-notes`: summarize changes for release notes.
- `fix`: enables write/commit tools only when `allow_fix: true`.

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

## Recommended GitHub App setup

For production use, generate a short-lived GitHub App token before running this action. That makes comments appear as your app, for example `garda-code[bot]`, instead of `github-actions[bot]`. See [`docs/setup-github-app.md`](docs/setup-github-app.md). For a Claude-style hosted token exchange, see [`docs/hosted-token-exchange.md`](docs/hosted-token-exchange.md).

```yaml
- name: Create Garda GitHub App token
  id: app-token
  uses: actions/create-github-app-token@v3
  with:
    client-id: ${{ vars.GARDA_APP_CLIENT_ID }}
    private-key: ${{ secrets.GARDA_APP_PRIVATE_KEY }}
    permission-contents: read
    permission-pull-requests: write
    permission-issues: write
    permission-actions: read

- uses: actions/checkout@v4
  with:
    fetch-depth: 0
    token: ${{ steps.app-token.outputs.token }}

- uses: neosantara/garda-code-action@v1
  with:
    github_token: ${{ steps.app-token.outputs.token }}
    trigger_phrase: "@garda"
  env:
    NEOSANTARA_API_KEY: ${{ secrets.NEOSANTARA_API_KEY }}
```

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
  fallback_model: |
    deepseek-v3
    qwen-2.5-coder
    # tried in order if the primary model is unavailable (503/404/422)
  commit_strategy: "github-api" # fix mode only
```

`commit_strategy: github-api` uses the GitHub Git Data API to create commits on the target branch. It avoids depending on git push credential state and is the closest action-local equivalent to Claude Code Action file-ops commits. Real hosted token exchange still requires a Neosantara backend; the action includes the OIDC client hook only.

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
