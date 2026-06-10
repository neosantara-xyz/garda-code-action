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

/**
 * Resolve the GitHub token used for all API calls in this run.
 *
 * Resolution order depends on `use_github_app_token_exchange`:
 * - "on": always use the hosted OIDC exchange; throw if it fails.
 * - "off": use the provided `github_token` / `GITHUB_TOKEN` only.
 * - "auto" (default): try the hosted exchange when OIDC and a hosted URL are
 *   available, otherwise fall back to the workflow token.
 *
 * @param config Action configuration (mutated: `githubToken` is set to the result).
 * @returns The resolved GitHub token.
 * @throws If no token can be obtained.
 */
export async function resolveGitHubToken(
  config: ActionConfig,
): Promise<string> {
  const fallbackToken = config.githubToken || process.env.GITHUB_TOKEN || "";
  const oidcAvailable = Boolean(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);

  // Decide whether to attempt the hosted token exchange.
  // - "on": always attempt (fail hard if it fails)
  // - "off": never attempt
  // - "auto" (default): attempt only when OIDC is available AND a hosted URL is
  //   configured, then gracefully fall back to the workflow token if the app is
  //   not installed or the exchange is unavailable.
  const shouldAttemptExchange =
    config.useGitHubAppTokenExchange === "on" ||
    (config.useGitHubAppTokenExchange === "auto" &&
      oidcAvailable &&
      Boolean(config.githubAppTokenExchangeUrl));

  if (shouldAttemptExchange) {
    try {
      const token = await exchangeOidcForGitHubToken(config);
      config.githubToken = token;
      core.info("Using garda-code[bot] token from hosted token exchange.");
      return token;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (config.useGitHubAppTokenExchange === "on") {
        // Explicitly requested — do not silently fall back.
        throw err;
      }
      // auto mode: fall back to the workflow token (e.g. app not installed).
      core.info(
        `Hosted token exchange unavailable; falling back to workflow token. (${message})`,
      );
    }
  }

  if (!fallbackToken) {
    throw new Error(
      "No GitHub token available. Install the Garda Code app with id-token: write, set github_token, or provide GITHUB_TOKEN.",
    );
  }
  core.setSecret(fallbackToken);
  config.githubToken = fallbackToken;
  return fallbackToken;
}
