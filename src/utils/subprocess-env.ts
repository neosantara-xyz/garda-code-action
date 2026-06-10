import type { ToolExecutionContext } from "../tools/types.js";

// Non-secret env vars that git, ripgrep, and Node tooling legitimately need.
// Tokens/secrets are deliberately excluded; GH_TOKEN is only added when a tool
// explicitly opts in via options.githubToken.
const SAFE_ENV_KEYS = [
  "PATH",
  "HOME",
  "GITHUB_WORKSPACE",
  "GITHUB_REPOSITORY",
  "GITHUB_SERVER_URL",
  "GITHUB_API_URL",
  "GITHUB_RUN_ID",
  "RUNNER_TEMP",
  "RUNNER_OS",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LANGUAGE",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "CI",
  "GITHUB_ACTIONS",
  "NODE_OPTIONS",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
];

/**
 * Build a scrubbed environment for tool subprocesses (git, ripgrep, etc.).
 *
 * Security: by default we ALWAYS restrict the environment to a non-secret
 * allowlist so runner secrets (NEOSANTARA_API_KEY, arbitrary *_TOKEN/*_SECRET
 * vars, etc.) never leak into subprocesses or their error output. The GitHub
 * token is injected as GH_TOKEN only when a tool explicitly needs it
 * (git push/commit), never to read-only tools like ripgrep.
 */
export function subprocessEnv(
  ctx?: Pick<ToolExecutionContext, "github">,
  options: { githubToken?: boolean } = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  if (options.githubToken) {
    const token = ctx?.github.config.githubToken || process.env.GH_TOKEN;
    if (token) env.GH_TOKEN = token;
  }
  return env;
}
