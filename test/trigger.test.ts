import { describe, expect, it } from "vitest";
import { containsTrigger } from "../src/github/trigger.js";
import type { NeoContext } from "../src/github/context.js";

const base = {
  eventName: "issue_comment",
  actor: "er",
  runId: "1",
  runUrl: "https://example.com",
  repository: { owner: "o", repo: "r", fullName: "o/r" },
  isEntity: true,
  isPR: true,
  entityNumber: 1,
  eventAction: "created",
  config: {
    triggerPhrase: "@garda",
    assigneeTrigger: "",
    labelTrigger: "garda",
    mode: "auto",
    prompt: "",
    model: "grok-code-fast",
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
    allowFix: false,
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
    restoreTrustedConfig: true,
    ignore: "",
    dryRun: false,
    showFullOutput: false,
  },
} as unknown as NeoContext;

describe("containsTrigger", () => {
  it("matches trigger phrase in comments", () => {
    expect(
      containsTrigger({
        ...base,
        payload: { comment: { body: "please @garda review" } },
      }),
    ).toBe(true);
  });

  it("does not match embedded words", () => {
    expect(
      containsTrigger({
        ...base,
        payload: { comment: { body: "hello@garda" } },
      }),
    ).toBe(false);
  });
});
