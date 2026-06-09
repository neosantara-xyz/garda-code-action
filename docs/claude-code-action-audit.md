# Claude Code Action Compatibility Audit

This repo follows Claude Code Action's production architecture where it matters for GitHub safety and UX, while replacing Claude Code CLI with a Neosantara Responses API runner.

Audit basis: `claude-code-action-main.zip` checked against this repo on 2026-06-09. Re-audited for v0.1.7 against Claude Code Action source files under `src/entrypoints`, `src/github/operations`, `src/github/data`, `src/mcp/github-inline-comment-server`, and `test/format-turns.test.ts`.

## Matched production patterns

| Claude Code Action pattern        | Garda Code implementation                                                                                                                | Status                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Tag mode vs automation/agent mode | `detectExecutionMode()` supports trigger-driven and prompt-driven runs.                                                                  | Matched                                    |
| Trigger validation                | `containsTrigger()` supports comments, PR title/body, issue title/body, labels, assignees, review comments.                              | Matched                                    |
| Actor guard                       | `validateActorAndPermissions()` blocks unlisted bots and non-write users by default.                                                     | Matched                                    |
| Permission guard                  | Same default posture: write access required unless explicit allowlist is configured.                                                     | Matched                                    |
| PR workspace preparation          | PR head is checked out before repo tools run; fix mode checks out same-repo PR branch.                                                   | Matched in smaller form                    |
| Sensitive config restore          | `restoreTrustedConfigFromBase()` snapshots PR-authored config to `.garda-pr/`, deletes untrusted copies, then restores from base branch. | Matched                                    |
| Bounded tool surface              | Internal registry exposes only declared GitHub/repo tools, no arbitrary GitHub API or shell.                                             | Matched                                    |
| Stateful agent/tool loop          | Neosantara Responses API uses `previous_response_id` between tool rounds.                                                                | Matched conceptually                       |
| Inline comment buffering          | `github_buffer_inline_comment` stores candidates; posting is delayed until the end and filters confirmed=false / obvious test probes.    | Matched in smaller form                    |
| Sticky progress comment           | One progress/result comment is created or updated.                                                                                       | Matched                                    |
| Failure finalization              | Errors update the tracking comment when one exists.                                                                                      | Matched in v0.1.3                          |
| Bot identity support              | `bot_id` and `bot_name` support GitHub App commit identity.                                                                              | Matched for user-provided GitHub App token |

## v0.1.3 fixes from the re-audit

- Deferred `NEOSANTARA_API_KEY` validation until after trigger/skip checks, matching Claude's behavior of not failing no-trigger events before model auth is needed.
- Blocked `mode=fix` for non-PR events until issue branch creation is implemented. This prevents accidental commits to the default checkout branch.
- Moved fork/non-fork fix validation after PR hydration so issue-comment triggers on PRs are correctly classified.
- Added realpath-based path validation for `repo_read_file` and `repo_write_file` to block symlink escapes outside `GITHUB_WORKSPACE`.
- Removed shell execution from `repo_grep`; it now calls `rg` with argv instead of shell interpolation.
- Redacted downloaded CI job logs before returning them to the model.
- Added review-comment reply support for `pull_request_review_comment` events, closer to Claude's threaded reply behavior.
- Restricted sticky comment reuse to bot/app comments containing the Garda Code marker, avoiding accidental update of user-authored marker comments.
- Added failure update of the tracking comment, similar to Claude's `finally` cleanup path.
- Disabled GitHub Step Summary model output by default via `display_report=false`, matching Claude's safer default.
- Hardened prompt boundaries: only the trigger source/workflow prompt is treated as the task instruction; PR body, prior comments, files, and CI logs are untrusted context.

## v0.1.4 fixes from deeper Claude parity audit

- Added Claude-style content sanitization for comments, review comments, titles, diff patches, and user request extraction: HTML comments, hidden attributes, invisible/control characters, markdown image alt text, markdown link titles, HTML entities, and secrets are stripped/redacted before model context.
- Added trigger-time filtering for issue comments and review comments. Comments/reviews created or edited after the trigger timestamp are excluded from model context, reducing TOCTOU prompt-injection risk.
- Restricted `pull_request_review` triggers to `submitted` and `edited`, matching Claude's event posture.
- Set GitHub token as an Actions secret immediately after reading config.
- Hardened fix-mode commit auth: configures a credential helper backed by `GH_TOKEN`, keeps tokens out of `.git/config` and command arguments, resets `origin` to a clean URL, and sets bot commit identity before push.
- Added repository-relative file validation for `git_commit_files` arguments and applies ignore patterns before staging.

## v0.1.5 fixes from branch/fix parity audit

- Renamed user-facing branding from Neo Code Action to Garda Code Action, with default trigger `@garda`, default label `garda`, and default bot identity `garda-code[bot]`. `bot_name` remains configurable, so `neosantara-ai[bot]` also works.
- Added Claude-style issue branch creation for `mode=fix` + `allow_fix=true` on issue events. Garda Code creates a branch from the default/base branch using `branch_prefix` and `branch_name_template`.
- Added final tracking comment branch/compare link for issue fix runs so maintainers can create a PR from the generated branch.
- Extended commit push handling so same-repo PR fix mode pushes to the PR head branch, while issue fix mode pushes to the generated work branch.
- Added `confirmed` support and heuristic test/probe filtering for buffered inline comments. This is not as strong as Claude's model classifier, but avoids obvious tool-test comments being posted.
- Added branch template and inline-comment filtering tests.

## v0.1.6 fixes from post-step/review parity audit

- Added `base_branch` input for issue fix branch creation, matching Claude's configurable base branch behavior.
- Added `classify_inline_comments`, `batch_inline_comments`, and `include_fix_links` inputs. Buffered inline comments are now posted through `pulls.createReview` as one PR review when possible, with fallback to individual `createReviewComment` calls.
- Added compact fix-request hints to inline comments when `include_fix_links=true`. This is a lighter-weight equivalent of Claude's fix links until a hosted Garda Code deep-link flow exists.
- Added execution transcript capture. The runner records Responses API steps, tool calls, tool results, and guard events, writes them to `execution_file`, and exposes `session_id`/`branch_name` outputs.
- Added `github_token` output for downstream steps, while keeping it masked with `core.setSecret`.
- Extended tests to assert batch review posting and runner transcript guard events.

## v0.1.7 fixes from multimodal/finalization parity audit

- Added Claude-style GitHub user-attachment image discovery and best-effort download for issue bodies, PR bodies, trigger comments, issue comments, review comments, and review bodies. Downloaded images are passed to Neosantara Responses API as `input_image` multimodal context when `include_image_context=true`.
- Added image guardrails: only GitHub `user-attachments/assets` URLs are considered, non-image/SVG content is skipped, `max_comment_images` and `max_image_bytes` bound request size, and image metadata is recorded without base64 payload in the execution transcript.
- Added `cleanup_empty_branch` and branch finalization for issue fix mode. Garda-created branches are compared against the base branch and deleted when no changes were committed, closer to Claude's post-step branch cleanup behavior.
- Added subprocess environment scrubbing for model-directed child processes when `allowed_non_write_users` is configured. `repo_grep` runs with a reduced environment; commit/push gets only a minimal environment plus `GH_TOKEN`.
- Added tests for GitHub image URL extraction and empty-branch cleanup.

## Intentional differences

- No Claude CLI, Anthropic SDK, Bedrock, Vertex, or Foundry paths.
- No hosted OIDC token exchange. Garda Code expects `github_token` from either `github.token` or `actions/create-github-app-token`.
- No unrestricted Bash tool in v0.1.x.
- No MCP server process. Internal tool registry provides equivalent GitHub/repo operations for now.
- Issue branch creation is implemented for fix mode, but still needs more live GitHub matrix testing before v1.
- Inline-comment filtering exists for confirmed=false and obvious test/probe comments; a Neosantara-powered classifier can still be added later.
- No signed commits or GitHub API commit-signing path yet.

## Remaining gaps before v1

| Gap                                       | Severity          | Suggested fix                                                                                                                        |
| ----------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Live GitHub App/token matrix not tested   | High              | Test private repo, public repo, same-repo PR, fork PR, and issue-comment trigger.                                                    |
| Test coverage still far below Claude      | High              | Add unit tests for data TOCTOU filtering, sanitizer, git auth config, comment finalization, and workflow/pull_request_target events. |
| Issue branch creation live coverage       | High for fix mode | Test issue fix mode in a real repository and validate final compare/PR link behavior.                                                |
| Inline comment classifier still heuristic | Medium            | Upgrade heuristic inline-comment filtering to a Neosantara-powered classifier if needed.                                             |
| Commit signing missing                    | Medium            | Add SSH signing or GitHub API commit path.                                                                                           |
| MCP compatibility missing                 | Low/Medium        | Add optional MCP server bridge after core action is stable.                                                                          |

## v0.1.8 fixes from large-gap parity audit

- Added Neosantara-powered model inline-comment classifier (`inline_classifier_mode=model`) with heuristic fallback. The classifier rejects probe/test comments, generic/nit/style-only comments, unsupported comments, and comments below `min_inline_severity` before PR review posting.
- Added `inline_classifier_model` and `min_inline_severity` inputs for production tuning.
- Added GitHub API commit strategy (`commit_strategy=github-api`) for fix mode. This creates blobs, trees, commits, and ref updates through the GitHub Git Data API, reducing dependence on `git push` auth state. `use_commit_signing=true` is treated as a compatibility hint that selects this safer API strategy when `commit_strategy` is not set; real cryptographic signing still depends on GitHub/App configuration.
- Added MCP-style compatibility aliases for the main GitHub/repo tools, including `mcp__github_comment__update_garda_comment`, `mcp__github_comment__update_claude_comment`, `mcp__github_inline_comment__create_inline_comment`, and `mcp__github_file_ops__commit_files`.
- Added client-side hosted token exchange hook using GitHub Actions OIDC (`use_github_app_token_exchange`, `github_app_token_exchange_url`, `github_app_token_exchange_audience`). This mirrors Claude's shape, but still requires a Neosantara backend token exchange service.
- Added docs for MCP compatibility and hosted token exchange.

## Updated intentional differences after v0.1.8

- Hosted OIDC token exchange is supported only on the action client side. Neosantara must still deploy the backend exchange service before this can replace `actions/create-github-app-token`.
- `commit_strategy=github-api` is safer and closer to Claude file-ops commits, but it is not the same as SSH commit signing.
- MCP compatibility is an alias layer inside the Responses API tool loop, not a separate MCP server process.

## v0.1.9 fixes from release-readiness/tool-policy parity audit

- Added trusted `custom_instructions` workflow input. This mirrors Claude Code Action's maintainer-supplied custom instructions pattern while keeping repository files, comments, PR bodies, and CI logs untrusted.
- Added `allowed_tools` and `disallowed_tools` exact/glob policy filters. This lets maintainers run restricted workflows such as read-only CI analysis or PR review without exposing every available GitHub/repo tool. Mutation tools remain unavailable unless `allow_fix` and mode guards permit repository mutation.
- Added `max_runtime_seconds` wall-clock guard around the Responses API tool loop so a model cannot continue tool-calling until the GitHub job times out.
- Added tests for tool allow/deny policy and custom instruction prompt boundaries.

## Updated remaining gaps after v0.1.9

| Gap                           | Severity                   | Suggested fix                                                                                                  |
| ----------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Hosted backend token exchange | High for official bot SaaS | Deploy Neosantara OIDC exchange endpoint and validate issuer/audience/repository claims.                       |
| Live GitHub App matrix        | High                       | Test public/private repos, same-repo PR, fork PR, issue fix branch, and review-comment reply trigger.          |
| Full MCP server process       | Medium                     | Current implementation has MCP-style aliases; add a real MCP bridge only if external MCP clients must connect. |
| Cryptographic commit signing  | Medium                     | Current `github-api` strategy is safer for GitHub App writes, but not equivalent to SSH/GPG signing.           |
| Marketplace polish            | Medium                     | Add screenshots, release notes, security policy, and a pinned v1 tag after live tests.                         |

## v0.1.10 TypeScript parity update

Claude Code Action still contains some `any` at external integration boundaries, but Garda Code Action previously had more `any` in production source. v0.1.10 removes syntax-level `any` from Garda production source and tests, adds stricter compiler flags matching Claude's important strictness settings, and documents the audit in `docs/typescript-parity-audit.md`.
