import { describe, expect, it } from "vitest";
import { containsTrigger, extractUserRequest } from "../src/github/trigger.js";
import { formatGitHubContext } from "../src/github/data.js";
import type { GitHubData } from "../src/github/data.js";
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
    maxOutputTokens: 8000,
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

describe("extractUserRequest", () => {
  it("strips trigger phrase and returns the request", () => {
    const req = extractUserRequest({
      ...base,
      payload: { comment: { body: "@garda fix this null check" } },
    });
    expect(req).toBe("fix this null check");
  });

  it("returns fallback when only the trigger phrase is present", () => {
    const req = extractUserRequest({
      ...base,
      payload: { comment: { body: "@garda" } },
    });
    expect(req).toContain("Review this context");
  });
});

describe("formatGitHubContext trigger location", () => {
  const emptyData = {
    entity: {},
    comments: [],
    reviewComments: [],
    reviews: [],
    changedFiles: [],
    diff: "",
    ciStatus: null,
    commentImages: [],
  } as unknown as GitHubData;

  it("surfaces file/line when triggered on a PR review comment", () => {
    const ctx = {
      ...base,
      eventName: "pull_request_review_comment",
      isPR: true,
      payload: {
        comment: {
          body: "@garda fix this",
          path: "src/foo.ts",
          line: 42,
          diff_hunk: "@@ -40,3 +40,4 @@\n+bad();",
        },
      },
    } as unknown as NeoContext;
    const out = formatGitHubContext(ctx, emptyData);
    expect(out).toContain("TRIGGER COMMENT LOCATION");
    expect(out).toContain("src/foo.ts:42");
    expect(out).toContain("Diff hunk context");
  });

  it("omits trigger location for non-review-comment events", () => {
    const ctx = {
      ...base,
      eventName: "issue_comment",
      payload: { comment: { body: "@garda review" } },
    } as unknown as NeoContext;
    const out = formatGitHubContext(ctx, emptyData);
    expect(out).not.toContain("TRIGGER COMMENT LOCATION");
  });

  it("includes prior PR review bodies in context", () => {
    const ctx = {
      ...base,
      eventName: "pull_request_review_comment",
      isPR: true,
      payload: { comment: { body: "@garda fix" } },
    } as unknown as NeoContext;
    const data = {
      ...emptyData,
      reviews: [
        {
          user: { login: "reviewer1" },
          state: "CHANGES_REQUESTED",
          submitted_at: "2026-01-01T00:00:00Z",
          body: "Please fix the SQL injection in auth.ts",
        },
      ],
    } as unknown as GitHubData;
    const out = formatGitHubContext(ctx, data);
    expect(out).toContain("Prior PR reviews");
    expect(out).toContain("CHANGES_REQUESTED");
    expect(out).toContain("SQL injection");
  });
});
