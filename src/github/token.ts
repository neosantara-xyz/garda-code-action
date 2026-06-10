import * as core from "@actions/core";
import type { ActionConfig } from "../config.js";

type ExchangeResponse = {
  token?: string;
  github_token?: string;
  expires_at?: string;
};

async function exchangeOidcForGitHubToken(
  config: ActionConfig,
): Promise<string> {
  // SECURITY NOTE: The token-exchange endpoint MUST independently validate that
  // the calling workflow exists on the repository's default branch before
  // issuing an elevated GitHub App token. Without that server-side check, a
  // malicious PR could add a workflow (e.g. on pull_request_target) and mint a
  // token for an unreviewed workflow. This client only forwards the OIDC token;
  // it cannot enforce that guard locally. (Mirrors Claude's WorkflowValidation.)
  if (!config.githubAppTokenExchangeUrl) {
    throw new Error(
      "use_github_app_token_exchange=true requires github_app_token_exchange_url.",
    );
  }
  const idToken = await core.getIDToken(config.githubAppTokenExchangeAudience);
  core.setSecret(idToken);
  const response = await fetch(config.githubAppTokenExchangeUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      audience: config.githubAppTokenExchangeAudience,
      repository: process.env.GITHUB_REPOSITORY || "",
      run_id: process.env.GITHUB_RUN_ID || "",
      ref: process.env.GITHUB_REF || "",
      sha: process.env.GITHUB_SHA || "",
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `GitHub App token exchange failed: ${response.status} ${body.slice(0, 500)}`,
    );
  }
  const json = (await response.json()) as ExchangeResponse;
  const token = json.token || json.github_token;
  if (!token) throw new Error("Token exchange response did not include token.");
  core.setSecret(token);
  if (json.expires_at)
    core.info(`GitHub App token expires at ${json.expires_at}`);
  return token;
}

export async function resolveGitHubToken(
  config: ActionConfig,
): Promise<string> {
  if (config.useGitHubAppTokenExchange) {
    const token = await exchangeOidcForGitHubToken(config);
    config.githubToken = token;
    return token;
  }
  const token = config.githubToken || process.env.GITHUB_TOKEN || "";
  if (!token) {
    throw new Error(
      "github_token input, GITHUB_TOKEN, or use_github_app_token_exchange=true is required.",
    );
  }
  core.setSecret(token);
  config.githubToken = token;
  return token;
}
