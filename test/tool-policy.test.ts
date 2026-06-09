import { describe, expect, it } from "vitest";
import {
  buildToolRegistry,
  filterToolsByPolicy,
} from "../src/tools/registry.js";
import type { NeoTool } from "../src/tools/types.js";

const fakeTools = [
  { name: "repo_read_file" },
  { name: "repo_write_file" },
  { name: "github_get_ci_status" },
] as NeoTool[];

describe("tool policy", () => {
  it("allows exact and glob tool patterns", () => {
    const filtered = filterToolsByPolicy(
      fakeTools,
      "repo_*,github_get_ci_status",
      "repo_write_file",
    );
    expect(filtered.map((tool) => tool.name)).toEqual([
      "repo_read_file",
      "github_get_ci_status",
    ]);
  });

  it("does not expose write/commit tools when repository mutation is disabled", () => {
    const registry = buildToolRegistry(false, true, "*", "");
    expect(registry.has("repo_write_file")).toBe(false);
    expect(registry.has("git_commit_files")).toBe(false);
    expect(registry.has("mcp__github_file_ops__commit_files")).toBe(false);
  });

  it("can remove MCP aliases with deny patterns", () => {
    const registry = buildToolRegistry(true, true, "*", "mcp__*");
    expect([...registry.keys()].some((name) => name.startsWith("mcp__"))).toBe(
      false,
    );
    expect(registry.has("git_commit_files")).toBe(true);
  });
});
