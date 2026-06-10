import { describe, expect, it } from "vitest";
import type OpenAI from "openai";
import {
  buildToolRegistry,
  buildResponsesTools,
} from "../src/tools/registry.js";
import { runNeoAgent } from "../src/neosantara/runner.js";
import type { NeoContext } from "../src/github/context.js";
import type { GitHubData } from "../src/github/data.js";
import type { GitHubClient } from "../src/github/types.js";

type ResponseRequest = {
  previous_response_id?: string;
  input?: Array<{ output?: string; content?: Array<{ text?: string }> }>;
  tools?: Array<{ name?: string }>;
  tool_choice?: string;
};

function hasToolName(tool: unknown, name: string): boolean {
  return (
    typeof tool === "object" &&
    tool !== null &&
    "name" in tool &&
    (tool as { name?: unknown }).name === name
  );
}

function context(): NeoContext {
  return {
    eventName: "pull_request",
    eventAction: "opened",
    actor: "alice",
    runId: "1",
    runUrl: "https://example.com",
    repository: { owner: "o", repo: "r", fullName: "o/r" },
    payload: { pull_request: { head: { sha: "abc" } } },
    isEntity: true,
    isPR: true,
    isForkPR: false,
    isPullRequestTarget: false,
    entityNumber: 1,
    baseBranch: "main",
    headBranch: "feature",
    baseRepoFullName: "o/r",
    headRepoFullName: "o/r",
    headSha: "abc",
    config: {
      triggerPhrase: "@garda",
      baseBranch: "",
      assigneeTrigger: "",
      labelTrigger: "garda",
      mode: "review",
      prompt: "",
      model: "gemini-3.5-flash",
      neosantaraBaseUrl: "https://api.neosantara.xyz/v1",
      githubToken: "t",
      allowedBots: "",
      allowedNonWriteUsers: "",
      includeCommentsByActor: "",
      excludeCommentsByActor: "",
      reviewLanguage: "id",
      customInstructions: "",
      inlineComments: true,
      classifyInlineComments: true,
      batchInlineComments: true,
      includeFixLinks: true,
      trackProgress: true,
      useStickyComment: true,
      allowFix: false,
      commitMessage: "chore: apply Garda Code changes",
      branchPrefix: "garda/",
      branchNameTemplate:
        "{{prefix}}{{entityType}}-{{entityNumber}}-{{description}}",
      maxSteps: 3,
      maxDiffChars: 80000,
      maxFileChars: 30000,
      maxInlineComments: 20,
      maxToolCallsPerStep: 8,
      maxRepeatedToolCalls: 1,
      retryMaxAttempts: 1,
      maxRuntimeSeconds: 900,
      includeImageContext: true,
      maxCommentImages: 5,
      maxImageBytes: 1572864,
      cleanupEmptyBranch: true,
      restoreTrustedConfig: true,
      ignore: "",
      dryRun: false,
      showFullOutput: false,
      botId: "",
      botName: "garda-code[bot]",
      inlineClassifierMode: "model",
      inlineClassifierModel: "gemini-3.5-flash",
      minInlineSeverity: "low",
      commitStrategy: "git",
      useCommitSigning: false,
      sshSigningKey: "",
      enableMcpCompat: true,
      allowedTools: "",
      disallowedTools: "",
      useGitHubAppTokenExchange: "off",
      githubAppTokenExchangeUrl: "",
      githubAppTokenExchangeAudience: "garda-code-action",
      fallbackModels: [],
    },
  };
}

const data: GitHubData = {
  entity: { title: "PR" },
  comments: [],
  reviewComments: [],
  reviews: [],
  changedFiles: [
    {
      filename: "src/a.ts",
      status: "modified",
      additions: 1,
      deletions: 0,
      changes: 1,
    },
  ],
  diff: "diff -- src/a.ts",
  ciStatus: null,
  commentImages: [],
};

describe("tool registry", () => {
  it("exposes read-only tools and omits write/commit tools unless mutation is allowed", () => {
    const readonlyRegistry = buildToolRegistry(false);
    expect(readonlyRegistry.has("repo_read_file")).toBe(true);
    expect(readonlyRegistry.has("repo_write_file")).toBe(false);
    expect(readonlyRegistry.has("git_commit_files")).toBe(false);
    expect(
      readonlyRegistry.has("mcp__github_comment__update_garda_comment"),
    ).toBe(true);
    expect(readonlyRegistry.has("mcp__github_file_ops__commit_files")).toBe(
      false,
    );

    const mutationRegistry = buildToolRegistry(true);
    expect(mutationRegistry.has("repo_write_file")).toBe(true);
    expect(mutationRegistry.has("git_commit_files")).toBe(true);
    expect(mutationRegistry.has("mcp__github_file_ops__commit_files")).toBe(
      true,
    );
  });

  it("builds Responses API function tool definitions", () => {
    const registry = buildToolRegistry(false);
    const tools = buildResponsesTools(registry);
    expect(tools[0]).toHaveProperty("type", "function");
    expect(
      tools.some((tool) => hasToolName(tool, "github_buffer_inline_comment")),
    ).toBe(true);
  });
});

describe("Responses runner hardening", () => {
  it("uses previous_response_id and blocks repeated identical tool calls", async () => {
    const requests: ResponseRequest[] = [];
    const responses = [
      {
        id: "r1",
        output: [
          {
            type: "function_call",
            call_id: "c1",
            name: "repo_get_changed_files",
            arguments: "{}",
          },
        ],
        usage: { input_tokens: 1 },
      },
      {
        id: "r2",
        output: [
          {
            type: "function_call",
            call_id: "c2",
            name: "repo_get_changed_files",
            arguments: "{}",
          },
        ],
        usage: { input_tokens: 2 },
      },
      { id: "r3", output_text: "done", output: [], usage: { input_tokens: 3 } },
    ];
    const client = {
      responses: {
        create: async (body: unknown) => {
          requests.push(body as ResponseRequest);
          return responses.shift();
        },
      },
    } as unknown as OpenAI;

    const result = await runNeoAgent({
      client,
      github: context(),
      data,
      systemPrompt: "system",
      taskPrompt: "task",
      octokit: {} as unknown as GitHubClient,
      trackingComment: null,
      setTrackingComment() {},
      inlineBuffer: [],
    });

    expect(result.text).toBe("done");
    expect(
      result.transcript.some(
        (entry) =>
          entry.type === "tool_call" && entry.name === "repo_get_changed_files",
      ),
    ).toBe(true);
    expect(
      result.transcript.some(
        (entry) =>
          entry.type === "guard" && entry.name === "repo_get_changed_files",
      ),
    ).toBe(true);
    expect(requests.at(1)?.previous_response_id).toBe("r1");
    expect(requests.at(2)?.previous_response_id).toBe("r2");
    expect(requests.at(2)?.input?.at(0)?.output).toContain(
      "Tool repetition guard",
    );
  });

  it("forces a final text report when the step budget is nearly exhausted", async () => {
    const requests: ResponseRequest[] = [];
    // A model that keeps calling a (varied) tool every turn and never stops on
    // its own. The runner must force a finish near the step limit.
    let counter = 0;
    const client = {
      responses: {
        create: async (body: unknown) => {
          const req = body as ResponseRequest;
          requests.push(req);
          // When the runner forces finishing, honor it by returning text.
          if (req.tool_choice === "none") {
            return {
              id: `rf${counter}`,
              output_text: "final report under pressure",
              output: [],
              usage: { input_tokens: 1 },
            };
          }
          counter += 1;
          return {
            id: `r${counter}`,
            output: [
              {
                type: "function_call",
                call_id: `c${counter}`,
                name: "repo_read_file",
                arguments: JSON.stringify({ path: `file-${counter}.ts` }),
              },
            ],
            usage: { input_tokens: 1 },
          };
        },
      },
    } as unknown as OpenAI;

    const ctx = context(); // maxSteps = 3
    const result = await runNeoAgent({
      client,
      github: ctx,
      data,
      systemPrompt: "system",
      taskPrompt: "task",
      octokit: {} as unknown as GitHubClient,
      trackingComment: null,
      setTrackingComment() {},
      inlineBuffer: [],
    });

    // The run ends with a real report, not the generic max_steps message.
    expect(result.text).toBe("final report under pressure");
    // The last request forced text-only output.
    expect(requests.at(-1)?.tool_choice).toBe("none");
    // A wrap-up / step-limit nudge was injected into the input.
    const injectedTexts = requests
      .flatMap((r) => r.input || [])
      .flatMap((i) => i.content || [])
      .map((c) => c.text || "");
    expect(
      injectedTexts.some(
        (t) => t.includes("STEP LIMIT") || t.includes("steps left"),
      ),
    ).toBe(true);
  });

  it("retries with fallback model when primary returns 503", async () => {
    const requests: Array<{ model?: string }> = [];
    const ctx = context();
    ctx.config.fallbackModels = ["backup-model"];
    let primaryCalls = 0;
    const client = {
      responses: {
        create: async (body: { model?: string }) => {
          requests.push(body);
          if (body.model === "gemini-3.5-flash") {
            primaryCalls += 1;
            const err = new Error("model unavailable") as Error & {
              status?: number;
            };
            err.status = 503;
            throw err;
          }
          // Fallback model succeeds with a plain text answer
          return {
            id: "rf",
            output_text: "fallback done",
            output: [],
            usage: { input_tokens: 1 },
          };
        },
      },
    } as unknown as OpenAI;

    const result = await runNeoAgent({
      client,
      github: ctx,
      data,
      systemPrompt: "system",
      taskPrompt: "task",
      octokit: {} as unknown as GitHubClient,
      trackingComment: null,
      setTrackingComment() {},
      inlineBuffer: [],
    });

    expect(result.text).toBe("fallback done");
    // Primary attempted (with its own internal retries), then fallback used
    expect(primaryCalls).toBeGreaterThanOrEqual(1);
    expect(requests.some((r) => r.model === "backup-model")).toBe(true);
  });

  it("walks through multiple fallback models in order until one succeeds", async () => {
    const triedModels: string[] = [];
    const ctx = context();
    ctx.config.fallbackModels = ["fallback-a", "fallback-b"];
    const client = {
      responses: {
        create: async (body: { model?: string }) => {
          triedModels.push(body.model as string);
          // Primary and the first fallback are unavailable; second succeeds.
          if (
            body.model === "gemini-3.5-flash" ||
            body.model === "fallback-a"
          ) {
            const err = new Error("unavailable") as Error & {
              status?: number;
            };
            err.status = 503;
            throw err;
          }
          return {
            id: "rb",
            output_text: "second fallback done",
            output: [],
            usage: { input_tokens: 1 },
          };
        },
      },
    } as unknown as OpenAI;

    const result = await runNeoAgent({
      client,
      github: ctx,
      data,
      systemPrompt: "system",
      taskPrompt: "task",
      octokit: {} as unknown as GitHubClient,
      trackingComment: null,
      setTrackingComment() {},
      inlineBuffer: [],
    });

    expect(result.text).toBe("second fallback done");
    expect(triedModels).toContain("gemini-3.5-flash");
    expect(triedModels).toContain("fallback-a");
    expect(triedModels).toContain("fallback-b");
    // Order preserved: a before b
    expect(triedModels.indexOf("fallback-a")).toBeLessThan(
      triedModels.indexOf("fallback-b"),
    );
  });
});
