import * as core from "@actions/core";
import type OpenAI from "openai";
import type { NeoContext } from "../github/context.js";
import type { GitHubData } from "../github/data.js";
import type { TrackingComment } from "../github/comments.js";
import { isRepositoryMutationAllowed } from "../github/permissions.js";
import type { InlineComment, ToolExecutionContext } from "../tools/types.js";
import type { GitHubClient } from "../github/types.js";
import {
  buildResponsesTools,
  buildToolRegistry,
  executeTool,
} from "../tools/registry.js";
import { redact } from "../utils/redact.js";
import { truncateText } from "../utils/text.js";

export type TranscriptEvent = {
  step: number;
  type: "response" | "tool_call" | "tool_result" | "guard";
  name?: string;
  input?: unknown;
  output?: unknown;
  responseId?: string;
  ok?: boolean;
};

export type RunnerResult = {
  text: string;
  responseId?: string;
  usage?: unknown;
  steps: number;
  transcript: TranscriptEvent[];
};

type ToolCall = { call_id: string; name: string; arguments: string | object };

type ResponseContentItem = {
  type?: string;
  text?: string;
};

type ResponseOutputItem = {
  type?: string;
  call_id?: string;
  id?: string;
  name?: string;
  arguments?: string | object;
  function?: {
    name?: string;
    arguments?: string;
  };
  content?: ResponseContentItem[];
};

type NeosantaraResponse = {
  id?: string;
  output?: ResponseOutputItem[];
  output_text?: string;
  usage?: unknown;
};

type RetryableError = {
  status?: number | string;
  code?: number | string;
  headers?: Record<string, string | number | undefined>;
  response?: {
    status?: number | string;
    headers?: Record<string, string | number | undefined>;
  };
};

function isRetryableError(value: unknown): value is RetryableError {
  return typeof value === "object" && value !== null;
}

function parseToolCalls(response: NeosantaraResponse): ToolCall[] {
  const output = response.output || [];
  const calls: ToolCall[] = [];
  for (const item of output) {
    if (item.type === "function_call") {
      calls.push({
        call_id: item.call_id || item.id || "",
        name: item.name || "unknown_tool",
        arguments: item.arguments || "{}",
      });
    }
    if (item.type === "tool_call" && item.function) {
      calls.push({
        call_id: item.id || "",
        name: item.function.name || "unknown_tool",
        arguments: item.function.arguments || "{}",
      });
    }
  }
  return calls;
}

function extractText(response: NeosantaraResponse): string {
  if (typeof response.output_text === "string" && response.output_text.trim())
    return response.output_text;
  const parts: string[] = [];
  for (const item of response.output || []) {
    if (item.type === "message") {
      for (const content of item.content || []) {
        if (content.type === "output_text" || content.type === "text")
          parts.push(content.text || "");
      }
    }
  }
  return parts.join("\n").trim();
}

function initialResponsesInput(
  systemPrompt: string,
  taskPrompt: string,
  data: GitHubData,
): Array<Record<string, unknown>> {
  const images = data.commentImages || [];
  if (images.length === 0) {
    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: taskPrompt },
    ];
  }
  return [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: [
        { type: "input_text", text: taskPrompt },
        ...images.map((image) => ({
          type: "input_image",
          image_url: image.dataUrl,
          detail: "auto",
        })),
      ],
    },
  ];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(error: unknown, attempt: number): number {
  const headers = isRetryableError(error)
    ? error.headers || error.response?.headers || {}
    : {};
  const retryAfter = headers["retry-after"] || headers["Retry-After"];
  const parsed = Number.parseFloat(String(retryAfter || ""));
  if (Number.isFinite(parsed) && parsed >= 0)
    return Math.min(parsed * 1000, 15000);
  return Math.min(1000 * 2 ** (attempt - 1), 8000);
}

function isRetryable(error: unknown): boolean {
  const status = isRetryableError(error)
    ? error.status || error.response?.status || error.code
    : undefined;
  return (
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    (typeof status === "number" && status >= 500)
  );
}

async function createResponseWithRetry(
  client: OpenAI,
  body: Record<string, unknown>,
  maxAttempts: number,
): Promise<NeosantaraResponse> {
  const attempts = Math.max(1, maxAttempts);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return (await client.responses.create(
        body as never,
      )) as unknown as NeosantaraResponse;
    } catch (error) {
      if (attempt >= attempts || !isRetryable(error)) {
        // Try the next fallback model on final attempt if configured and the
        // error is model-availability related. Fallbacks are tried in order.
        const status = isRetryableError(error)
          ? error.status || error.response?.status
          : undefined;
        const fallbacks: string[] = Array.isArray(
          (body as any).__fallbackModels,
        )
          ? (body as any).__fallbackModels
          : [];
        const next = fallbacks.find((m) => m && m !== body.model);
        if (next && (status === 503 || status === 404 || status === 422)) {
          core.warning(
            `Model ${body.model} unavailable (${status}); retrying with fallback model: ${next}`,
          );
          return createResponseWithRetry(
            client,
            {
              ...body,
              model: next,
              // Drop the one we're about to use so we advance through the list.
              __fallbackModels: fallbacks.filter((m) => m !== next),
            },
            2,
          );
        }
        throw error;
      }
      const wait = retryAfterMs(error, attempt);
      core.warning(
        `Neosantara Responses API transient error. Retry ${attempt}/${attempts - 1} in ${wait}ms.`,
      );
      await sleep(wait);
    }
  }
  throw new Error("Responses API retry loop ended without a response.");
}

function toolSignature(call: ToolCall): string {
  const args =
    typeof call.arguments === "string"
      ? call.arguments
      : JSON.stringify(call.arguments);
  return `${call.name}:${args}`;
}

export async function runNeoAgent(params: {
  client: OpenAI;
  github: NeoContext;
  data: GitHubData;
  systemPrompt: string;
  taskPrompt: string;
  octokit: GitHubClient;
  trackingComment: TrackingComment;
  setTrackingComment(comment: TrackingComment): void;
  inlineBuffer: InlineComment[];
}): Promise<RunnerResult> {
  const allowRepositoryMutation = isRepositoryMutationAllowed(params.github);
  const registry = buildToolRegistry(
    allowRepositoryMutation,
    params.github.config.enableMcpCompat,
    params.github.config.allowedTools,
    params.github.config.disallowedTools,
  );

  const existingToolNames = new Set(registry.keys());
  const { loadAndStartMcpServers, buildNativeMcpTools } =
    await import("../mcp/client.js");
  const mcpData = await loadAndStartMcpServers(existingToolNames);
  for (const tool of mcpData.tools) {
    registry.set(tool.name, tool);
  }

  // Load native MCP tools (server_url-based) from .mcp.json
  const cwd = process.env.GITHUB_WORKSPACE || process.cwd();
  const mcpConfigPath = `${cwd}/.mcp.json`;
  let nativeMcpTools: Array<Record<string, unknown>> = [];
  try {
    const { readFileSync, existsSync } = await import("node:fs");
    if (existsSync(mcpConfigPath)) {
      const mcpConfig = JSON.parse(readFileSync(mcpConfigPath, "utf8"));
      nativeMcpTools = buildNativeMcpTools(mcpConfig);
      if (nativeMcpTools.length > 0)
        core.info(
          `Loaded ${nativeMcpTools.length} native MCP tools from .mcp.json`,
        );
    }
  } catch (err) {
    core.warning(
      `Failed to load native MCP tools: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const tools = buildResponsesTools(registry);
  core.info(`Tool policy enabled ${registry.size} tools.`);
  let previousResponseId: string | undefined;
  let input: Array<Record<string, unknown>> = initialResponsesInput(
    params.systemPrompt,
    params.taskPrompt,
    params.data,
  );
  let finalText = "";
  let lastUsage: unknown;
  let responseId: string | undefined;
  const repeatedTools = new Map<string, number>();
  const transcript: TranscriptEvent[] = [];
  const startedAt = Date.now();
  const deadlineMs = Math.max(1, params.github.config.maxRuntimeSeconds) * 1000;

  const toolCtx: ToolExecutionContext = {
    octokit: params.octokit,
    github: params.github,
    data: params.data,
    trackingComment: params.trackingComment,
    setTrackingComment(comment) {
      params.setTrackingComment(comment);
      toolCtx.trackingComment = comment;
    },
    inlineBuffer: params.inlineBuffer,
  };

  try {
    for (let step = 1; step <= params.github.config.maxSteps; step += 1) {
      if (Date.now() - startedAt > deadlineMs) {
        transcript.push({
          step,
          type: "guard",
          ok: false,
          output: `max_runtime_seconds=${params.github.config.maxRuntimeSeconds} reached`,
        });
        return {
          text: "Garda Code stopped because max_runtime_seconds was reached.",
          responseId,
          usage: lastUsage,
          steps: step - 1,
          transcript,
        };
      }
      core.info(`Garda Code Responses API step ${step}`);

      // Near the end of the step budget, nudge the model to stop inspecting and
      // return its final report. Weaker models otherwise keep calling read tools
      // until max_steps is hit, producing no review. The final two steps force a
      // text-only answer (tool_choice: "none").
      const stepsRemaining = params.github.config.maxSteps - step;
      const finishWindow = Math.max(
        2,
        Math.ceil(params.github.config.maxSteps * 0.2),
      );
      const forceFinish = stepsRemaining <= 1;
      if (stepsRemaining < finishWindow && Array.isArray(input)) {
        input.push({
          role: "user",
          content: [
            {
              type: "input_text",
              text: forceFinish
                ? "STEP LIMIT REACHED. Do not call any more tools. Reply now with your final review report as plain text, summarizing the findings you have already buffered."
                : `You have about ${stepsRemaining} tool-loop steps left. Wrap up: buffer any remaining concrete findings now, then stop calling tools and return your final review report as plain text.`,
            },
          ],
        });
      }

      const response = await createResponseWithRetry(
        params.client,
        {
          model: params.github.config.model,
          input,
          previous_response_id: previousResponseId,
          tools: [...tools, ...nativeMcpTools],
          tool_choice: forceFinish ? "none" : "auto",
          store: true,
          ...(params.github.config.fallbackModels.length > 0
            ? { __fallbackModels: params.github.config.fallbackModels }
            : {}),
          metadata: {
            github_repository: params.github.repository.fullName,
            github_run_id: params.github.runId,
            mode: params.github.config.mode,
            fork_pr: String(params.github.isForkPR),
            repository_mutation_allowed: String(allowRepositoryMutation),
          },
        },
        params.github.config.retryMaxAttempts,
      );

      responseId = response.id;
      previousResponseId = response.id;
      lastUsage = response.usage;
      transcript.push({
        step,
        type: "response",
        responseId,
        output: {
          usage: lastUsage,
          output_types: (response.output || []).map((item) => item.type),
          input_images:
            step === 1 ? (params.data.commentImages || []).length : 0,
        },
      });
      if (params.github.config.showFullOutput)
        core.info(redact(JSON.stringify(response, null, 2)));

      const calls = parseToolCalls(response);
      if (calls.length === 0) {
        finalText =
          extractText(response) ||
          "Garda Code finished without a textual response.";
        return {
          text: redact(finalText),
          responseId,
          usage: lastUsage,
          steps: step,
          transcript,
        };
      }

      input = [];
      const executableCalls = calls.slice(
        0,
        params.github.config.maxToolCallsPerStep,
      );
      const skippedCalls = calls.slice(
        params.github.config.maxToolCallsPerStep,
      );

      for (const call of executableCalls) {
        const signature = toolSignature(call);
        const seen = (repeatedTools.get(signature) || 0) + 1;
        repeatedTools.set(signature, seen);

        if (seen > params.github.config.maxRepeatedToolCalls) {
          core.warning(`Tool repetition guard blocked ${call.name}.`);
          transcript.push({
            step,
            type: "guard",
            name: call.name,
            input: call.arguments,
            ok: false,
            output: "Tool repetition guard blocked identical call.",
          });
          input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify({
              ok: false,
              output: `Tool repetition guard: ${call.name} with identical arguments was called too many times.`,
            }),
          });
          continue;
        }

        core.info(`Executing tool: ${call.name}`);
        transcript.push({
          step,
          type: "tool_call",
          name: call.name,
          input: call.arguments,
        });
        const result = await executeTool(
          registry,
          call.name,
          call.arguments,
          toolCtx,
        );
        transcript.push({
          step,
          type: "tool_result",
          name: call.name,
          ok: result.ok,
          output: truncateText(redact(JSON.stringify(result.output)), 12000),
        });
        input.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: truncateText(redact(JSON.stringify(result)), 60000),
        });
      }

      for (const call of skippedCalls) {
        transcript.push({
          step,
          type: "guard",
          name: call.name,
          input: call.arguments,
          ok: false,
          output: `max_tool_calls_per_step=${params.github.config.maxToolCallsPerStep}`,
        });
        input.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify({
            ok: false,
            output: `Tool call skipped: max_tool_calls_per_step=${params.github.config.maxToolCallsPerStep} reached.`,
          }),
        });
      }
    }

    return {
      text: "Garda Code stopped because max_steps was reached.",
      responseId,
      usage: lastUsage,
      steps: params.github.config.maxSteps,
      transcript,
    };
  } finally {
    await mcpData.stopAll();
  }
}
