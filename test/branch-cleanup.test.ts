import { describe, expect, it } from "vitest";
import { finalizeCreatedBranch } from "../src/github/branch-cleanup.js";
import type { NeoContext } from "../src/github/context.js";
import type { GitHubClient } from "../src/github/types.js";

function context(): NeoContext {
  return {
    eventName: "issues",
    eventAction: "opened",
    actor: "alice",
    runId: "1",
    runUrl: "https://example.com",
    repository: {
      owner: "o",
      repo: "r",
      fullName: "o/r",
      defaultBranch: "main",
    },
    payload: {},
    isEntity: true,
    isPR: false,
    isForkPR: false,
    isPullRequestTarget: false,
    entityNumber: 9,
    baseBranch: "main",
    workingBranch: "garda/issue-9-fix",
    createdBranch: true,
    config: {
      triggerPhrase: "@garda",
      baseBranch: "",
      assigneeTrigger: "",
      labelTrigger: "garda",
      mode: "fix",
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
      ignore: "",
      dryRun: false,
      showFullOutput: false,
      displayReport: false,
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
    },
  };
}

describe("branch cleanup", () => {
  it("deletes Garda-created branches that have no changes", async () => {
    const deleted: string[] = [];
    const ctx = context();
    const octokit = {
      rest: {
        repos: {
          compareCommitsWithBasehead: async () => ({
            data: { total_commits: 0, files: [] },
          }),
        },
        git: {
          deleteRef: async (_args: { ref: string }) => {
            deleted.push(_args.ref);
            return { data: {} };
          },
        },
      },
    };

    const result = await finalizeCreatedBranch(
      octokit as unknown as GitHubClient,
      ctx,
    );
    expect(result.deleted).toBe(true);
    expect(deleted).toEqual(["heads/garda/issue-9-fix"]);
    expect(ctx.createdBranch).toBe(false);
  });
});
