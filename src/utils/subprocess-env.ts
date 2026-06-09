import type { ToolExecutionContext } from "../tools/types.js";

const SAFE_ENV_KEYS = [
  "PATH",
  "HOME",
  "GITHUB_WORKSPACE",
  "RUNNER_TEMP",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "CI",
  "GITHUB_ACTIONS",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
];

export function subprocessEnv(
  ctx?: Pick<ToolExecutionContext, "github">,
  options: { githubToken?: boolean } = {},
): NodeJS.ProcessEnv {
  const mustScrub = Boolean(ctx?.github.config.allowedNonWriteUsers.trim());
  if (!mustScrub) {
    return options.githubToken
      ? {
          ...process.env,
          GH_TOKEN: ctx?.github.config.githubToken || process.env.GH_TOKEN,
        }
      : process.env;
  }

  const env: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  if (options.githubToken && ctx?.github.config.githubToken) {
    env.GH_TOKEN = ctx.github.config.githubToken;
  }
  return env;
}
