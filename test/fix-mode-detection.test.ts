import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildContextFromPayload } from "../src/github/context.js";
import { shouldSwitchToFixMode } from "../src/modes/detector.js";
import type { ActionConfig } from "../src/config.js";

const baseConfig: ActionConfig = {
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
  allowFix: true,
  commitMessage: "chore: apply Garda Code changes",
  branchPrefix: "garda/",
  branchNameTemplate:
    "{{prefix}}{{entityType}}-{{entityNumber}}-{{description}}",
  botId: "",
  botName: "garda-code[bot]",
  inlineClassifierMode: "model",
  inlineClassifierModel: "gemini-3.5-flash",
  minInlineSeverity: "low",
  commitStrategy: "github-api",
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
  includeImageContext: true,
  maxCommentImages: 5,
  maxImageBytes: 1572864,
  cleanupEmptyBranch: true,
  restoreTrustedConfig: true,
  ignore: "",
  dryRun: false,
  showFullOutput: false,
  displayReport: false,
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
    config: { ...baseConfig, ...overrides },
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

describe("shouldSwitchToFixMode", () => {
  it("does NOT switch on an automatic pull_request event even if the body says 'fix'", () => {
    const context = ctx("pull_request_opened");
    // PR body mentions fixing — must not trigger fix mode on an auto PR event.
    (context.payload as { pull_request?: { body?: string } }).pull_request = {
      ...(context.payload as { pull_request?: object }).pull_request,
      body: "This PR adds a CHANGELOG and validates the fix.",
    };
    expect(shouldSwitchToFixMode(context)).toBe(false);
  });

  it("switches when a trigger comment explicitly asks for a fix", () => {
    const context = ctx("issue_comment_trigger");
    (context.payload as { comment?: { body?: string } }).comment = {
      body: "@garda fix the null check in auth.ts",
    };
    expect(shouldSwitchToFixMode(context)).toBe(true);
  });

  it("does NOT switch for a review-only trigger comment", () => {
    const context = ctx("issue_comment_trigger");
    (context.payload as { comment?: { body?: string } }).comment = {
      body: "@garda review security only",
    };
    expect(shouldSwitchToFixMode(context)).toBe(false);
  });

  it("respects negation in the trigger comment", () => {
    const context = ctx("issue_comment_trigger");
    (context.payload as { comment?: { body?: string } }).comment = {
      body: "@garda just explain the issue, don't fix it",
    };
    expect(shouldSwitchToFixMode(context)).toBe(false);
  });

  it("does NOT switch when allow_fix is disabled", () => {
    const context = ctx("issue_comment_trigger", { allowFix: false });
    (context.payload as { comment?: { body?: string } }).comment = {
      body: "@garda fix this",
    };
    expect(shouldSwitchToFixMode(context)).toBe(false);
  });
});
