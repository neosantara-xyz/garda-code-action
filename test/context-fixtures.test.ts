import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildContextFromPayload } from "../src/github/context.js";
import { containsTrigger } from "../src/github/trigger.js";
import { detectExecutionMode } from "../src/modes/detector.js";
import { assertFixAllowed } from "../src/github/permissions.js";
import type { ActionConfig } from "../src/config.js";

const config: ActionConfig = {
  triggerPhrase: "@garda",
  baseBranch: "",
  assigneeTrigger: "",
  labelTrigger: "garda",
  mode: "auto",
  prompt: "",
  model: "grok-code-fast",
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
  maxSteps: 40,
  maxDiffChars: 80000,
  maxFileChars: 30000,
  maxInlineComments: 20,
  maxToolCallsPerStep: 8,
  maxRepeatedToolCalls: 3,
  retryMaxAttempts: 3,
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
  inlineClassifierModel: "grok-code-fast",
  minInlineSeverity: "low",
  commitStrategy: "git",
  useCommitSigning: false,
  sshSigningKey: "",
  enableMcpCompat: true,
  allowedTools: "",
  disallowedTools: "",
  useGitHubAppTokenExchange: false,
  githubAppTokenExchangeUrl: "",
  githubAppTokenExchangeAudience: "garda-code-action",
      fallbackModels: [],
};

function fixture(name: string) {
  return JSON.parse(
    readFileSync(
      new URL(`../fixtures/events/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
}

function ctx(name: string, overrides: Partial<ActionConfig> = {}) {
  const payload = fixture(name);
  const [owner, repo] = payload.repository.full_name.split("/");
  return buildContextFromPayload({
    config: { ...config, ...overrides },
    eventName: payload.__eventName,
    eventAction: payload.action,
    actor: payload.sender?.login || "tester",
    payload,
    repository: {
      owner,
      repo,
      fullName: payload.repository.full_name,
      defaultBranch: payload.repository.default_branch,
    },
    runId: "1",
  });
}

describe("GitHub event fixtures", () => {
  it("detects comment trigger", () => {
    const context = ctx("issue_comment_trigger");
    expect(containsTrigger(context)).toBe(true);
    expect(detectExecutionMode(context)).toBe("tag");
  });

  it("skips comments without trigger", () => {
    const context = ctx("issue_comment_no_trigger");
    expect(containsTrigger(context)).toBe(false);
    expect(detectExecutionMode(context)).toBe("skip");
  });

  it("marks fork PRs and blocks fix mode", () => {
    const context = ctx("fork_pull_request", { mode: "fix", allowFix: true });
    expect(context.isForkPR).toBe(true);
    expect(() => assertFixAllowed(context)).toThrow(/fork pull requests/);
  });

  it("supports workflow prompt mode", () => {
    const context = ctx("workflow_dispatch", {
      prompt: "summarize repository",
      mode: "ask",
    });
    expect(detectExecutionMode(context)).toBe("agent");
  });
});
