import { describe, expect, it } from "vitest";
import {
  postBufferedInlineComments,
  rightSideLinesInPatch,
} from "../src/tools/github.js";
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
          listReviewComments: async () => ({ data: [] }),
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

  it("skips findings that already exist as inline comments (re-review dedup)", async () => {
    const calls: ReviewCall[] = [];
    const octokit = {
      rest: {
        pulls: {
          // An identical finding already exists on src/a.ts:3.
          listReviewComments: async () => ({
            data: [
              {
                path: "src/a.ts",
                line: 3,
                body: "This null check can still throw when user.profile is missing.",
              },
            ],
          }),
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
      {
        path: "src/a.ts",
        line: 3,
        body: "This null check can still throw when user.profile is missing.",
      },
      {
        path: "src/b.ts",
        line: 9,
        body: "New finding not seen before.",
      },
    ];

    const result = await postBufferedInlineComments(
      octokit as unknown as GitHubClient,
      ctx,
      comments,
    );
    // Only the new finding is posted; the duplicate is skipped.
    expect(result.posted).toBe(1);
    expect(result.skipped).toBe(1);
    expect(calls.at(0)?.comments).toHaveLength(1);
  });
});

describe("rightSideLinesInPatch", () => {
  it("returns added and context line numbers from a unified diff", () => {
    const patch = [
      "@@ -1,3 +1,4 @@",
      " context line 1",
      "-removed line",
      "+added line a",
      "+added line b",
      " context line 2",
    ].join("\n");
    const lines = rightSideLinesInPatch(patch);
    // new file: line1=context, line2=added a, line3=added b, line4=context
    expect([...lines].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });

  it("handles multiple hunks with correct offsets", () => {
    const patch = [
      "@@ -1,1 +1,2 @@",
      " a",
      "+b",
      "@@ -10,1 +11,2 @@",
      " c",
      "+d",
    ].join("\n");
    const lines = rightSideLinesInPatch(patch);
    expect(lines.has(1)).toBe(true);
    expect(lines.has(2)).toBe(true);
    expect(lines.has(11)).toBe(true);
    expect(lines.has(12)).toBe(true);
    expect(lines.has(5)).toBe(false);
  });

  it("returns empty set for empty patch", () => {
    expect(rightSideLinesInPatch(undefined).size).toBe(0);
    expect(rightSideLinesInPatch("").size).toBe(0);
  });
});
