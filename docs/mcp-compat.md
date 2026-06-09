# MCP compatibility layer

Garda Code Action runs its own Neosantara Responses API tool loop. It does not require a separate MCP server process, but v0.1.8 exposes MCP-style tool aliases so prompts and workflows modeled after Claude Code Action can use familiar names.

Enabled by default:

```yaml
with:
  enable_mcp_compat: "true"
```

Aliases currently exposed:

| MCP-style alias                                     | Garda native tool                |
| --------------------------------------------------- | -------------------------------- |
| `mcp__github_comment__update_garda_comment`         | `github_update_tracking_comment` |
| `mcp__github_comment__update_claude_comment`        | `github_update_tracking_comment` |
| `mcp__github_inline_comment__create_inline_comment` | `github_buffer_inline_comment`   |
| `mcp__github_comment__create_summary_comment`       | `github_create_summary_comment`  |
| `mcp__github_ci__get_ci_status`                     | `github_get_ci_status`           |
| `mcp__github_ci__download_job_log`                  | `github_download_job_log`        |
| `mcp__github_file_ops__commit_files`                | `git_commit_files`               |
| `mcp__repo__read_file`                              | `repo_read_file`                 |
| `mcp__repo__grep`                                   | `repo_grep`                      |
| `mcp__repo__list_files`                             | `repo_list_files`                |
| `mcp__repo__write_file`                             | `repo_write_file`                |

This is a compatibility bridge, not a hosted MCP server. A separate MCP server bridge can be added later if Neosantara wants external clients to connect to the same GitHub tool surface.
