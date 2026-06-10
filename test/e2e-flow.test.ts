import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildContextFromPayload } from "../src/github/context.js";
import { containsTrigger } from "../src/github/trigger.js";
import { detectExecutionMode } from "../src/modes/detector.js";
import { assertFixAllowed } from "../src/github/permissions.js";
import type { ActionConfig } from "../src/config.js";
import type { GardaPayload } from "../src/github/types.js";

function baseConfig(overrides: Partial<ActionConfig> = {}): ActionConfig {
  return {
    triggerPhrase: "@garda",
    baseBranch: "",
    assigneeTrigger: "",
    labelTrigger: "garda",
    mode: "auto",
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
    branchNameTemplate: "{{prefix}}{{entityType}}-{{entityNumber}}",
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
    maxSteps: 40,
    maxDiffChars: 80000,
    maxFileChars: 30000,
    maxInlineComments: 20,
    maxToolCallsPerStep: 8,
    maxRepeatedToolCalls: 3,
    retryMaxAttempts: 3,
    maxRuntimeSeconds: 900,
    maxOutputTokens: 8000,
    includeImageContext: true,
    maxCommentImages: 5,
    maxImageBytes: 1572864,
    cleanupEmptyBranch: true,
    restoreTrustedConfig: true,
    ignore: "",
    dryRun: true,
    showFullOutput: false,
    displayReport: false,
    ...overrides,
  };
}

function loadFixture(name: string): GardaPayload & { __eventName?: string } {
  const path = resolve(`fixtures/events/${name}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function inferEvent(payload: GardaPayload & { __eventName?: string }): string {
  if (payload.__eventName) return payload.__eventName;
  if (payload.pull_request && payload.comment)
    return "pull_request_review_comment";
  if (payload.issue && payload.comment) return "issue_comment";
  if (payload.pull_request) return "pull_request";
  if (payload.issue) return "issues";
  return "workflow_dispatch";
}

function run(
  name: string,
  configOverrides: Partial<ActionConfig> = {},
  actor = "alice",
) {
  const payload = loadFixture(name);
  const eventName = inferEvent(payload);
  const context = buildContextFromPayload({
    config: baseConfig(configOverrides),
    eventName,
    eventAction: payload.action,
    actor,
    payload,
  });
  return {
    context,
    triggered: containsTrigger(context),
    mode: detectExecutionMode(context),
  };
}

describe("e2e: event → trigger → execution mode", () => {
  it("issue_comment with trigger phrase runs in tag mode", () => {
    const { triggered, mode } = run("issue_comment_trigger.json");
    expect(triggered).toBe(true);
    expect(mode).toBe("tag");
  });

  it("issue_comment without trigger phrase is skipped", () => {
    const { triggered, mode } = run("issue_comment_no_trigger.json");
    expect(triggered).toBe(false);
    expect(mode).toBe("skip");
  });

  it("pull_request opened runs in agent mode (auto review)", () => {
    const { mode } = run("pull_request_opened.json");
    expect(mode).toBe("agent");
  });

  it("workflow_dispatch without prompt is skipped", () => {
    const { mode } = run("workflow_dispatch.json");
    expect(mode).toBe("skip");
  });

  it("fork PR is flagged as fork", () => {
    const { context } = run("fork_pull_request.json");
    expect(context.isForkPR).toBe(true);
  });
});

describe("e2e: fork PR fix-mode guard", () => {
  it("blocks fix mode on fork PRs even with allow_fix", () => {
    const { context } = run("fork_pull_request.json", {
      mode: "fix",
      allowFix: true,
    });
    expect(context.isForkPR).toBe(true);
    expect(() => assertFixAllowed(context)).toThrow(/fork/i);
  });

  it("blocks fix mode when allow_fix is false", () => {
    const payload = loadFixture("issue_comment_trigger.json");
    const context = buildContextFromPayload({
      config: baseConfig({ mode: "fix", allowFix: false }),
      eventName: "issue_comment",
      eventAction: payload.action,
      actor: "alice",
      payload,
    });
    expect(() => assertFixAllowed(context)).toThrow(/allow_fix/i);
  });
});
