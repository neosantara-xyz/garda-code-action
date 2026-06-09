import * as core from "@actions/core";
import { z } from "zod";

const bool = (name: string, fallback = false) => {
  const raw = core.getInput(name) || String(fallback);
  return raw.toLowerCase() === "true";
};

const int = (name: string, fallback: number) => {
  const raw = core.getInput(name);
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return value;
};

export const ActionModeSchema = z.enum([
  "auto",
  "review",
  "ask",
  "fix",
  "security",
  "ci-analysis",
  "release-notes",
]);

export type ActionMode = z.infer<typeof ActionModeSchema>;

export type ActionConfig = {
  triggerPhrase: string;
  baseBranch: string;
  assigneeTrigger: string;
  labelTrigger: string;
  mode: ActionMode;
  prompt: string;
  model: string;
  neosantaraBaseUrl: string;
  githubToken: string;
  allowedBots: string;
  allowedNonWriteUsers: string;
  includeCommentsByActor: string;
  excludeCommentsByActor: string;
  reviewLanguage: string;
  customInstructions: string;
  inlineComments: boolean;
  classifyInlineComments: boolean;
  batchInlineComments: boolean;
  includeFixLinks: boolean;
  trackProgress: boolean;
  useStickyComment: boolean;
  allowFix: boolean;
  commitMessage: string;
  branchPrefix: string;
  branchNameTemplate: string;
  botId: string;
  botName: string;
  inlineClassifierMode: "heuristic" | "model" | "off";
  inlineClassifierModel: string;
  minInlineSeverity: "low" | "medium" | "high";
  commitStrategy: "git" | "github-api";
  useCommitSigning: boolean;
  enableMcpCompat: boolean;
  allowedTools: string;
  disallowedTools: string;
  useGitHubAppTokenExchange: boolean;
  githubAppTokenExchangeUrl: string;
  githubAppTokenExchangeAudience: string;
  maxSteps: number;
  maxDiffChars: number;
  maxFileChars: number;
  maxInlineComments: number;
  maxToolCallsPerStep: number;
  maxRepeatedToolCalls: number;
  retryMaxAttempts: number;
  maxRuntimeSeconds: number;
  includeImageContext: boolean;
  maxCommentImages: number;
  maxImageBytes: number;
  cleanupEmptyBranch: boolean;
  restoreTrustedConfig: boolean;
  ignore: string;
  dryRun: boolean;
  showFullOutput: boolean;
  displayReport?: boolean;
};

export function readConfig(): ActionConfig {
  const modeRaw = core.getInput("mode") || "auto";
  const mode = ActionModeSchema.parse(modeRaw);
  const githubToken =
    core.getInput("github_token") || process.env.GITHUB_TOKEN || "";
  if (githubToken) core.setSecret(githubToken);

  return {
    triggerPhrase: core.getInput("trigger_phrase") || "@garda",
    baseBranch: core.getInput("base_branch") || "",
    assigneeTrigger: core.getInput("assignee_trigger") || "",
    labelTrigger: core.getInput("label_trigger") || "garda",
    mode,
    prompt: core.getInput("prompt") || "",
    model: core.getInput("model") || "grok-code-fast",
    neosantaraBaseUrl:
      core.getInput("neosantara_base_url") || "https://api.neosantara.xyz/v1",
    githubToken,
    allowedBots: core.getInput("allowed_bots") || "",
    allowedNonWriteUsers: core.getInput("allowed_non_write_users") || "",
    includeCommentsByActor: core.getInput("include_comments_by_actor") || "",
    excludeCommentsByActor: core.getInput("exclude_comments_by_actor") || "",
    reviewLanguage: core.getInput("review_language") || "id",
    customInstructions: core.getInput("custom_instructions") || "",
    inlineComments: bool("inline_comments", true),
    classifyInlineComments: bool("classify_inline_comments", true),
    batchInlineComments: bool("batch_inline_comments", true),
    includeFixLinks: bool("include_fix_links", true),
    trackProgress: bool("track_progress", true),
    useStickyComment: bool("use_sticky_comment", true),
    allowFix: bool("allow_fix", false),
    commitMessage:
      core.getInput("commit_message") || "chore: apply Garda Code changes",
    branchPrefix: core.getInput("branch_prefix") || "garda/",
    branchNameTemplate:
      core.getInput("branch_name_template") ||
      "{{prefix}}{{entityType}}-{{entityNumber}}-{{description}}",
    botId: core.getInput("bot_id") || "",
    botName: core.getInput("bot_name") || "garda-code[bot]",
    inlineClassifierMode: z
      .enum(["heuristic", "model", "off"])
      .catch("model")
      .parse(core.getInput("inline_classifier_mode") || "model"),
    inlineClassifierModel:
      core.getInput("inline_classifier_model") ||
      core.getInput("model") ||
      "grok-code-fast",
    minInlineSeverity: z
      .enum(["low", "medium", "high"])
      .catch("low")
      .parse(core.getInput("min_inline_severity") || "low"),
    commitStrategy: z
      .enum(["git", "github-api"])
      .catch("git")
      .parse(
        core.getInput("commit_strategy") ||
          (bool("use_commit_signing", false) ? "github-api" : "git"),
      ),
    useCommitSigning: bool("use_commit_signing", false),
    enableMcpCompat: bool("enable_mcp_compat", true),
    allowedTools: core.getInput("allowed_tools") || "",
    disallowedTools: core.getInput("disallowed_tools") || "",
    useGitHubAppTokenExchange: bool("use_github_app_token_exchange", false),
    githubAppTokenExchangeUrl:
      core.getInput("github_app_token_exchange_url") || "",
    githubAppTokenExchangeAudience:
      core.getInput("github_app_token_exchange_audience") ||
      "garda-code-action",
    maxSteps: int("max_steps", 40),
    maxDiffChars: int("max_diff_chars", 80000),
    maxFileChars: int("max_file_chars", 30000),
    maxInlineComments: int("max_inline_comments", 20),
    maxToolCallsPerStep: int("max_tool_calls_per_step", 8),
    maxRepeatedToolCalls: int("max_repeated_tool_calls", 3),
    retryMaxAttempts: int("retry_max_attempts", 3),
    maxRuntimeSeconds: int("max_runtime_seconds", 900),
    includeImageContext: bool("include_image_context", true),
    maxCommentImages: int("max_comment_images", 5),
    maxImageBytes: int("max_image_bytes", 1572864),
    cleanupEmptyBranch: bool("cleanup_empty_branch", true),
    restoreTrustedConfig: bool("restore_trusted_config", true),
    ignore: core.getInput("ignore") || "",
    dryRun: bool("dry_run", false),
    showFullOutput: bool("show_full_output", false),
    displayReport: bool("display_report", false),
  };
}
