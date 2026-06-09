import { minimatch } from "minimatch";
import type { NeoTool, ToolExecutionContext } from "./types.js";
import { toolDefinition } from "./types.js";
import { repoTools } from "./repo.js";
import { githubTools } from "./github.js";
import { commitTools } from "./commit.js";

function aliasTool(tool: NeoTool, name: string, description?: string): NeoTool {
  return { ...tool, name, description: description || tool.description };
}

function mcpCompatTools(tools: NeoTool[]): NeoTool[] {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const aliases: NeoTool[] = [];
  const add = (source: string, alias: string, description?: string) => {
    const tool = byName.get(source);
    if (tool) aliases.push(aliasTool(tool, alias, description));
  };

  add(
    "github_update_tracking_comment",
    "mcp__github_comment__update_garda_comment",
    "MCP-compatible alias: update the Garda tracking comment.",
  );
  add(
    "github_update_tracking_comment",
    "mcp__github_comment__update_claude_comment",
    "Claude Code Action compatibility alias: update the tracking comment.",
  );
  add(
    "github_buffer_inline_comment",
    "mcp__github_inline_comment__create_inline_comment",
    "MCP-compatible alias: buffer a validated inline PR comment candidate.",
  );
  add("github_get_ci_status", "mcp__github_ci__get_ci_status");
  add("github_download_job_log", "mcp__github_ci__download_job_log");
  add(
    "github_create_summary_comment",
    "mcp__github_comment__create_summary_comment",
  );
  add("repo_read_file", "mcp__repo__read_file");
  add("repo_grep", "mcp__repo__grep");
  add("repo_list_files", "mcp__repo__list_files");
  add("repo_write_file", "mcp__repo__write_file");
  add("git_commit_files", "mcp__github_file_ops__commit_files");
  return aliases;
}

function splitPatterns(value: string): string[] {
  return value
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function matchesAny(name: string, patterns: string[]): boolean {
  return patterns.some(
    (pattern) =>
      name === pattern || minimatch(name, pattern, { nocase: false }),
  );
}

export function filterToolsByPolicy(
  tools: NeoTool[],
  allowedTools = "",
  disallowedTools = "",
): NeoTool[] {
  const allow = splitPatterns(allowedTools);
  const deny = splitPatterns(disallowedTools);
  return tools.filter((tool) => {
    const allowed = allow.length === 0 || matchesAny(tool.name, allow);
    const denied = deny.length > 0 && matchesAny(tool.name, deny);
    return allowed && !denied;
  });
}

export function buildToolRegistry(
  allowRepositoryMutation: boolean,
  enableMcpCompat = true,
  allowedTools = "",
  disallowedTools = "",
): Map<string, NeoTool> {
  const baseRepoTools = allowRepositoryMutation
    ? repoTools
    : repoTools.filter((tool) => tool.readonly);
  const tools = [
    ...baseRepoTools,
    ...githubTools,
    ...(allowRepositoryMutation ? commitTools : []),
  ];
  const withAliases = enableMcpCompat
    ? [...tools, ...mcpCompatTools(tools)]
    : tools;
  const filtered = filterToolsByPolicy(
    withAliases,
    allowedTools,
    disallowedTools,
  );
  return new Map(filtered.map((tool) => [tool.name, tool]));
}

export function buildResponsesTools(registry: Map<string, NeoTool>) {
  return [...registry.values()].map(toolDefinition);
}

export async function executeTool(
  registry: Map<string, NeoTool>,
  name: string,
  rawArgs: string | object,
  ctx: ToolExecutionContext,
): Promise<{ ok: boolean; output: unknown }> {
  const tool = registry.get(name);
  if (!tool) return { ok: false, output: `Unknown or disabled tool: ${name}` };
  try {
    const args =
      typeof rawArgs === "string"
        ? rawArgs.trim()
          ? JSON.parse(rawArgs)
          : {}
        : rawArgs || {};
    const parsed = tool.schema.parse(args);
    return { ok: true, output: await tool.execute(parsed, ctx) };
  } catch (error) {
    return {
      ok: false,
      output: error instanceof Error ? error.message : String(error),
    };
  }
}
