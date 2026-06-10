import * as core from "@actions/core";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

function loadConfigFromFile(): Record<string, unknown> {
  const cwd = process.env.GITHUB_WORKSPACE || process.cwd();
  for (const name of ["garda-action.json", "neo-action.json"]) {
    const filePath = join(cwd, name);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf8");
        const parsed = JSON.parse(content);
        if (typeof parsed === "object" && parsed !== null) {
          return parsed as Record<string, unknown>;
        }
      } catch (err) {
        core.warning(
          `Failed to parse config file ${name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
  return {};
}

const fileConfig = loadConfigFromFile();

const getVal = (name: string, fallback: string): string => {
  const envKey = `INPUT_${name.toUpperCase()}`;
  if (process.env[envKey] !== undefined && process.env[envKey] !== "") {
    return process.env[envKey]!;
  }
  const camelName = name.replace(/_([a-z])/g, (_, g) => g.toUpperCase());
  if (fileConfig[name] !== undefined) return String(fileConfig[name]);
  if (fileConfig[camelName] !== undefined) return String(fileConfig[camelName]);
  const val = core.getInput(name);
  return val !== "" ? val : fallback;
};

const bool = (name: string, fallback = false) => {
  const raw = getVal(name, String(fallback));
  return raw.toLowerCase() === "true";
};

export const DEFAULT_IGNORE_PATTERNS = [
  // Secrets / credentials — never feed to the model or allow writes
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/id_rsa",
  "**/id_ed25519",
  "**/.npmrc",
  "**/.netrc",
  "**/credentials",
  "**/*.p12",
  "**/*.pfx",
  // Generated / build / dependency dirs
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/.next/**",
  "**/coverage/**",
  "**/vendor/**",
  "**/target/**",
  // Lock files
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
  "**/bun.lockb",
  "**/Cargo.lock",
  "**/poetry.lock",
  "**/composer.lock",
];

const int = (name: string, fallback: number) => {
  const raw = getVal(name, String(fallback));
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
  sshSigningKey: string;
  enableMcpCompat: boolean;
  allowedTools: string;
  disallowedTools: string;
  useGitHubAppTokenExchange: boolean;
  githubAppTokenExchangeUrl: string;
  githubAppTokenExchangeAudience: string;
  fallbackModels: string[];
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
  const modeRaw = getVal("mode", "auto");
  const mode = ActionModeSchema.parse(modeRaw);
  const githubToken = getVal("github_token", process.env.GITHUB_TOKEN || "");
  if (githubToken) core.setSecret(githubToken);

  return {
    triggerPhrase: getVal("trigger_phrase", "@garda"),
    baseBranch: getVal("base_branch", ""),
    assigneeTrigger: getVal("assignee_trigger", ""),
    labelTrigger: getVal("label_trigger", "garda"),
    mode,
    prompt: getVal("prompt", ""),
    model: getVal("model", "grok-code-fast"),
    neosantaraBaseUrl: getVal(
      "neosantara_base_url",
      "https://api.neosantara.xyz/v1",
    ),
    githubToken,
    allowedBots: getVal("allowed_bots", ""),
    allowedNonWriteUsers: getVal("allowed_non_write_users", ""),
    includeCommentsByActor: getVal("include_comments_by_actor", ""),
    excludeCommentsByActor: getVal("exclude_comments_by_actor", ""),
    reviewLanguage: getVal("review_language", "id"),
    customInstructions: getVal("custom_instructions", ""),
    inlineComments: bool("inline_comments", true),
    classifyInlineComments: bool("classify_inline_comments", true),
    batchInlineComments: bool("batch_inline_comments", true),
    includeFixLinks: bool("include_fix_links", true),
    trackProgress: bool("track_progress", true),
    useStickyComment: bool("use_sticky_comment", true),
    allowFix: bool("allow_fix", false),
    commitMessage: getVal("commit_message", "chore: apply Garda Code changes"),
    branchPrefix: getVal("branch_prefix", "garda/"),
    branchNameTemplate: getVal(
      "branch_name_template",
      "{{prefix}}{{entityType}}-{{entityNumber}}-{{description}}",
    ),
    botId: getVal("bot_id", ""),
    botName: getVal("bot_name", "garda-code[bot]"),
    inlineClassifierMode: z
      .enum(["heuristic", "model", "off"])
      .catch("model")
      .parse(getVal("inline_classifier_mode", "model")),
    inlineClassifierModel: getVal(
      "inline_classifier_model",
      getVal("model", "grok-code-fast"),
    ),
    minInlineSeverity: z
      .enum(["low", "medium", "high"])
      .catch("low")
      .parse(getVal("min_inline_severity", "low")),
    commitStrategy: z
      .enum(["git", "github-api"])
      .catch("git")
      .parse(
        getVal(
          "commit_strategy",
          bool("use_commit_signing", false) ? "github-api" : "git",
        ),
      ),
    useCommitSigning: bool("use_commit_signing", false),
    sshSigningKey: getVal("ssh_signing_key", ""),
    enableMcpCompat: bool("enable_mcp_compat", true),
    allowedTools: getVal("allowed_tools", ""),
    disallowedTools: getVal("disallowed_tools", ""),
    useGitHubAppTokenExchange: bool("use_github_app_token_exchange", false),
    githubAppTokenExchangeUrl: getVal("github_app_token_exchange_url", ""),
    githubAppTokenExchangeAudience: getVal(
      "github_app_token_exchange_audience",
      "garda-code-action",
    ),
    fallbackModels: getVal("fallback_model", "")
      .split(/[\n,]/)
      .map((m) => m.trim())
      .filter(Boolean),
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
    ignore: [getVal("ignore", ""), DEFAULT_IGNORE_PATTERNS.join(",")]
      .filter(Boolean)
      .join(","),
    dryRun: bool("dry_run", false),
    showFullOutput: bool("show_full_output", false),
    displayReport: bool("display_report", false),
  };
}

/**
 * Fail-fast validation of required runtime configuration. Collects ALL problems
 * and reports them at once instead of failing deep inside the run.
 */
export function validateConfig(config: ActionConfig): void {
  const problems: string[] = [];

  if (!process.env.NEOSANTARA_API_KEY) {
    problems.push(
      "NEOSANTARA_API_KEY environment variable is required (set it as a repository secret).",
    );
  }
  if (!config.githubToken && !config.useGitHubAppTokenExchange) {
    problems.push(
      "github_token is required (provide via input, GITHUB_TOKEN, or enable use_github_app_token_exchange).",
    );
  }
  if (!config.model || !config.model.trim()) {
    problems.push("model must be a non-empty Neosantara model id.");
  }
  if (config.maxSteps <= 0) {
    problems.push("max_steps must be greater than 0.");
  }
  if (config.maxRuntimeSeconds <= 0) {
    problems.push("max_runtime_seconds must be greater than 0.");
  }

  if (problems.length > 0) {
    throw new Error(
      `Garda Code Action configuration is invalid:\n- ${problems.join("\n- ")}`,
    );
  }
}
