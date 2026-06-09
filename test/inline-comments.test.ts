import { describe, expect, it } from "vitest";
import { postBufferedInlineComments } from "../src/tools/github.js";
import type { InlineComment } from "../src/tools/types.js";
import type { NeoContext } from "../src/github/context.js";
import type { GitHubClient } from "../src/github/types.js";

type ReviewCall = { comments?: Array<{ line?: number }> };

describe("inline comment buffer", () => {
  it("filters confirmed=false and obvious test/probe comments before posting", async () => {
    const calls: ReviewCall[] = [];
    const octokit = {
      rest: {
        pulls: {
          createReview: async (args: ReviewCall) => {
            calls.push(args);
            return { data: { id: 1, html_url: "https://example.com/review" } };
          },
          createReviewComment: async (args: ReviewCall) => {
            calls.push(args);
            return { data: { id: 1 } };
          },
        },
      },
    };
    const ctx = {
      isPR: true,
      entityNumber: 7,
      headSha: "abc123",
      repository: { owner: "o", repo: "r", fullName: "o/r" },
      payload: { pull_request: { head: { sha: "abc123" } } },
      config: {
        inlineComments: true,
        dryRun: false,
        maxInlineComments: 10,
        classifyInlineComments: true,
        batchInlineComments: true,
        includeFixLinks: false,
      },
    } as unknown as NeoContext;
    const comments: InlineComment[] = [
      { path: "src/a.ts", line: 1, body: "Test comment: does this work?" },
      { path: "src/a.ts", line: 2, body: "Do not post this", confirmed: false },
      {
        path: "src/a.ts",
        line: 3,
        body: "This null check can still throw when user.profile is missing.",
      },
    ];

    const result = await postBufferedInlineComments(
      octokit as unknown as GitHubClient,
      ctx,
      comments,
    );
    expect(result).toEqual({
      posted: 1,
      skipped: 2,
      reviewUrl: "https://example.com/review",
    });
    expect(calls).toHaveLength(1);
    expect(calls.at(0)?.comments).toHaveLength(1);
    expect(calls.at(0)?.comments?.at(0)?.line).toBe(3);
  });
});
