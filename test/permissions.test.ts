import { describe, expect, it } from "vitest";
import { isRepositoryMutationAllowed } from "../src/github/permissions.js";
import type { NeoContext } from "../src/github/context.js";

function context(overrides: Partial<NeoContext>): NeoContext {
  return {
    eventName: "pull_request",
    eventAction: "opened",
    actor: "alice",
    runId: "1",
    runUrl: "https://example.com",
    repository: { owner: "o", repo: "r", fullName: "o/r" },
    payload: {},
    isEntity: true,
    isPR: true,
    isForkPR: false,
    isPullRequestTarget: false,
    entityNumber: 1,
    config: {
      triggerPhrase: "@garda",
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
      restoreTrustedConfig: true,
      ignore: "",
      dryRun: false,
      showFullOutput: false,
    },
    ...overrides,
  } as NeoContext;
}

describe("repository mutation policy", () => {
  it("allows mutations only in fix mode with allow_fix on non-fork PRs", () => {
    expect(isRepositoryMutationAllowed(context({}))).toBe(true);
    expect(isRepositoryMutationAllowed(context({ isForkPR: true }))).toBe(
      false,
    );
    expect(
      isRepositoryMutationAllowed(
        context({ config: { ...context({}).config, mode: "review" } }),
      ),
    ).toBe(false);
  });
});
