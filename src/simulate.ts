#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildContextFromPayload } from "./github/context.js";
import { containsTrigger, extractUserRequest } from "./github/trigger.js";
import { detectExecutionMode } from "./modes/detector.js";
import { assertFixAllowed } from "./github/permissions.js";
import type { ActionConfig } from "./config.js";
import type { GardaPayload } from "./github/types.js";

function readArg(name: string, fallback = ""): string {
  const idx = process.argv.indexOf(name);
  const value = idx >= 0 ? process.argv[idx + 1] : undefined;
  return value || fallback;
}

function inferEventName(
  payload: GardaPayload & { __eventName?: string; sender?: { login?: string } },
): string {
  if (payload.__eventName) return payload.__eventName;
  if (payload.pull_request && payload.comment)
    return "pull_request_review_comment";
  if (payload.issue && payload.comment) return "issue_comment";
  if (payload.pull_request) return "pull_request";
  if (payload.issue) return "issues";
  return "workflow_dispatch";
}

const fixturePath = process.argv[2];
if (!fixturePath || fixturePath.startsWith("-")) {
  console.error(
    "Usage: npm run simulate -- fixtures/events/issue_comment_trigger.json [--mode review] [--prompt '...'] [--actor user]",
  );
  process.exit(2);
}

const payload = JSON.parse(
  readFileSync(resolve(fixturePath), "utf8"),
) as GardaPayload & { __eventName?: string; sender?: { login?: string } };
const eventName = readArg("--event", inferEventName(payload));
const actor = readArg("--actor", payload.sender?.login || "local-user");
const mode = readArg(
  "--mode",
  process.env.INPUT_MODE || "auto",
) as ActionConfig["mode"];
const prompt = readArg("--prompt", process.env.INPUT_PROMPT || "");
const triggerPhrase = readArg(
  "--trigger",
  process.env.INPUT_TRIGGER_PHRASE || "@garda",
);
const allowFix =
  readArg(
    "--allow-fix",
    process.env.INPUT_ALLOW_FIX || "false",
  ).toLowerCase() === "true";

const repoFullName =
  payload.repository?.full_name ||
  process.env.GITHUB_REPOSITORY ||
  "owner/repo";
const [owner = "owner", repo = "repo"] = repoFullName.split("/");

const config: ActionConfig = {
  triggerPhrase,
  baseBranch: process.env.INPUT_BASE_BRANCH || "",
  assigneeTrigger: process.env.INPUT_ASSIGNEE_TRIGGER || "",
  labelTrigger: process.env.INPUT_LABEL_TRIGGER || "garda",
  mode,
  prompt,
  model: process.env.INPUT_MODEL || "gemini-3.5-flash",
  neosantaraBaseUrl:
    process.env.INPUT_NEOSANTARA_BASE_URL || "https://api.neosantara.xyz/v1",
  githubToken: process.env.GITHUB_TOKEN || "simulated-token",
  allowedBots: process.env.INPUT_ALLOWED_BOTS || "",
  allowedNonWriteUsers: process.env.INPUT_ALLOWED_NON_WRITE_USERS || "",
  includeCommentsByActor: process.env.INPUT_INCLUDE_COMMENTS_BY_ACTOR || "",
  excludeCommentsByActor: process.env.INPUT_EXCLUDE_COMMENTS_BY_ACTOR || "",
  reviewLanguage: process.env.INPUT_REVIEW_LANGUAGE || "id",
  customInstructions: process.env.INPUT_CUSTOM_INSTRUCTIONS || "",
  inlineComments: true,
  classifyInlineComments: true,
  batchInlineComments: true,
  includeFixLinks: true,
  trackProgress: true,
  useStickyComment: true,
  allowFix,
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
  maxOutputTokens: 8000,
  includeImageContext: true,
  maxCommentImages: 5,
  maxImageBytes: 1572864,
  cleanupEmptyBranch: true,
  restoreTrustedConfig: true,
  ignore: "node_modules/**\ndist/**\n*.lock",
  dryRun: true,
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
};

const context = buildContextFromPayload({
  config,
  eventName,
  eventAction: payload.action,
  actor,
  payload,
  repository: {
    owner,
    repo,
    fullName: `${owner}/${repo}`,
    defaultBranch: payload.repository?.default_branch,
  },
  runId: "local-simulated-run",
});

let fixGuard: string | null = null;
try {
  assertFixAllowed(context);
} catch (error) {
  fixGuard = error instanceof Error ? error.message : String(error);
}

const result = {
  fixture: fixturePath,
  event: `${context.eventName}${context.eventAction ? `.${context.eventAction}` : ""}`,
  actor: context.actor,
  repository: context.repository.fullName,
  isEntity: context.isEntity,
  isPR: context.isPR,
  isForkPR: context.isForkPR,
  executionMode: detectExecutionMode(context),
  containsTrigger: containsTrigger(context),
  userRequest: extractUserRequest(context),
  fixGuard,
  dryRun: true,
};

console.log(JSON.stringify(result, null, 2));
