import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as core from "@actions/core";
import { resolveGitHubToken } from "../src/github/token.js";
import type { ActionConfig } from "../src/config.js";

vi.mock("@actions/core", () => ({
  setSecret: vi.fn(),
  info: vi.fn(),
  getIDToken: vi.fn(),
}));

// Build a minimal ActionConfig with only the fields resolveGitHubToken reads.
function makeConfig(overrides: Partial<ActionConfig> = {}): ActionConfig {
  return {
    githubToken: "",
    useGitHubAppTokenExchange: "auto",
    githubAppTokenExchangeUrl:
      "https://api.neosantara.xyz/github-app/token-exchange",
    githubAppTokenExchangeAudience: "garda-code-action",
    ...overrides,
  } as ActionConfig;
}

const savedEnv = { ...process.env };

describe("resolveGitHubToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clean slate for the env vars the resolver inspects.
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...savedEnv };
  });

  describe('mode "off"', () => {
    it("uses the provided github_token and never calls the exchange", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const config = makeConfig({
        useGitHubAppTokenExchange: "off",
        githubToken: "ghs_input",
      });

      const token = await resolveGitHubToken(config);

      expect(token).toBe("ghs_input");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("falls back to the GITHUB_TOKEN env var", async () => {
      process.env.GITHUB_TOKEN = "ghs_env";
      const config = makeConfig({ useGitHubAppTokenExchange: "off" });

      const token = await resolveGitHubToken(config);

      expect(token).toBe("ghs_env");
    });

    it("throws when no token is available", async () => {
      const config = makeConfig({ useGitHubAppTokenExchange: "off" });
      await expect(resolveGitHubToken(config)).rejects.toThrow(
        /No GitHub token available/,
      );
    });
  });

  describe('mode "auto"', () => {
    it("uses the workflow token without OIDC available", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const config = makeConfig({ githubToken: "ghs_input" });

      const token = await resolveGitHubToken(config);

      expect(token).toBe("ghs_input");
      // No OIDC env => exchange must not be attempted.
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("attempts the exchange when OIDC is available and returns the bot token", async () => {
      process.env.ACTIONS_ID_TOKEN_REQUEST_URL = "https://oidc.example";
      vi.mocked(core.getIDToken).mockResolvedValue("oidc-jwt");
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response(JSON.stringify({ token: "ghs_bot" }), { status: 200 }),
        );
      const config = makeConfig({ githubToken: "ghs_fallback" });

      const token = await resolveGitHubToken(config);

      expect(token).toBe("ghs_bot");
      expect(fetchSpy).toHaveBeenCalledOnce();
    });

    it("falls back to the workflow token when the exchange fails", async () => {
      process.env.ACTIONS_ID_TOKEN_REQUEST_URL = "https://oidc.example";
      vi.mocked(core.getIDToken).mockResolvedValue("oidc-jwt");
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("not installed", { status: 404 }),
      );
      const config = makeConfig({ githubToken: "ghs_fallback" });

      const token = await resolveGitHubToken(config);

      expect(token).toBe("ghs_fallback");
    });

    it("does not attempt the exchange when no hosted URL is configured", async () => {
      process.env.ACTIONS_ID_TOKEN_REQUEST_URL = "https://oidc.example";
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const config = makeConfig({
        githubToken: "ghs_input",
        githubAppTokenExchangeUrl: "",
      });

      const token = await resolveGitHubToken(config);

      expect(token).toBe("ghs_input");
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('mode "on"', () => {
    it("throws instead of falling back when the exchange fails", async () => {
      process.env.ACTIONS_ID_TOKEN_REQUEST_URL = "https://oidc.example";
      vi.mocked(core.getIDToken).mockResolvedValue("oidc-jwt");
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("boom", { status: 500 }),
      );
      const config = makeConfig({
        useGitHubAppTokenExchange: "on",
        githubToken: "ghs_fallback",
      });

      await expect(resolveGitHubToken(config)).rejects.toThrow(
        /token exchange failed/i,
      );
    });

    it("attempts the exchange even without OIDC env (forced)", async () => {
      vi.mocked(core.getIDToken).mockResolvedValue("oidc-jwt");
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ github_token: "ghs_bot2" }), {
          status: 200,
        }),
      );
      const config = makeConfig({ useGitHubAppTokenExchange: "on" });

      const token = await resolveGitHubToken(config);

      expect(token).toBe("ghs_bot2");
      expect(fetchSpy).toHaveBeenCalledOnce();
    });
  });
});
