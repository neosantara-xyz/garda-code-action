# Architecture

Garda Code Action mirrors the production shape of Claude Code Action while replacing the Claude CLI layer with a Neosantara Responses API runner.

## Flow

1. Parse GitHub event and action inputs.
2. Detect execution mode: `tag`, `agent`, or `skip`.
3. Validate trigger phrase, actor type, and repository write permission.
4. Create or update one sticky tracking comment.
5. Restore sensitive config from the PR base branch before trusting repo-local config.
6. Fetch PR/issue context, changed files, review comments, and CI status.
7. Build a prompt with explicit prompt-injection boundaries.
8. Run a stateful Responses API tool loop using `previous_response_id`.
9. Buffer inline comment candidates.
10. Validate and post buffered inline comments, preferably as one PR review.
11. Write a local execution transcript JSON file.
12. Update final tracking comment and action outputs.

## Why Responses API

The runner uses stateful turns instead of resending the full transcript every time. Each tool round sends `function_call_output` items with `previous_response_id` set to the prior response id.

## Tool boundary

The model cannot call arbitrary GitHub APIs. It only sees function tools registered by the action. Write tools are disabled unless `mode=fix` and `allow_fix=true`.

## Hardening

- `max_tool_calls_per_step` limits tool bursts from one model turn.
- `max_repeated_tool_calls` stops identical tool-call loops.
- `retry_max_attempts` retries transient Responses API failures and uses `Retry-After` when available.
- `restore_trusted_config` snapshots PR-authored sensitive config to `.garda-pr/` and restores trusted copies from the base branch.
- Repository mutation tools are omitted from the tool schema unless fix mode is explicitly allowed and the PR is not from a fork.
- Buffered inline comments are filtered before posting and can be batched via `pulls.createReview`.
- `execution_file` captures response/tool events for post-run debugging without dumping full model output to logs.

See [Claude Code Action Compatibility Audit](./claude-code-action-audit.md).
