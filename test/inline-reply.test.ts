import { describe, expect, it, vi } from "vitest";
import { createOrUpdateTrackingComment } from "../src/github/comments.js";
import type { NeoContext } from "../src/github/context.js";
import type { GitHubClient } from "../src/github/types.js";

function makeContext(eventName: string, commentId?: number): NeoContext {
  return {
    eventName,
    isEntity: true,
    isPR: true,
    entityNumber: 42,
    repository: { owner: "o", repo: "r" },
    runUrl: "https://github.com/o/r/actions/runs/1",
    config: {
      trackProgress: true,
      useStickyComment: true,
      dryRun: false,
      reviewLanguage: "en",
    },
    payload: commentId ? { comment: { id: commentId } } : {},
  } as unknown as NeoContext;
}

function makeOctokit(stickyComment?: { id: number; body: string }) {
  return {
    rest: {
      issues: {
        listComments: vi.fn(async () => ({
          data: stickyComment
            ? [
                {
                  id: stickyComment.id,
                  body: stickyComment.body,
                  user: { type: "Bot", login: "garda-code[bot]" },
                  html_url: "https://issue-comment",
                },
              ]
            : [],
        })),
        createComment: vi.fn(async () => ({
          data: { id: 1001, html_url: "https://new-issue-comment" },
        })),
        updateComment: vi.fn(async () => ({
          data: { id: 2002, html_url: "https://updated-issue-comment" },
        })),
      },
      pulls: {
        createReplyForReviewComment: vi.fn(async () => ({
          data: { id: 3003, html_url: "https://review-reply" },
        })),
        updateReviewComment: vi.fn(async () => ({
          data: { id: 3003, html_url: "https://review-reply" },
        })),
      },
    },
  } as unknown as GitHubClient;
}

describe("createOrUpdateTrackingComment — inline review replies", () => {
  it("replies in the inline thread for pull_request_review_comment, even when a sticky PR comment exists", async () => {
    const ctx = makeContext("pull_request_review_comment", 555);
    // A prior Garda comment exists on the PR (would be found as sticky).
    const octokit = makeOctokit({
      id: 999,
      body: "<!-- garda-code-action-comment -->\nold",
    });

    const result = await createOrUpdateTrackingComment(
      octokit,
      ctx,
      null,
      "working",
    );

    // Must reply in-thread, not reuse the sticky issue comment.
    expect(
      octokit.rest.pulls.createReplyForReviewComment,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 555, pull_number: 42 }),
    );
    expect(octokit.rest.issues.updateComment).not.toHaveBeenCalled();
    expect(result?.kind).toBe("review");
  });

  it("uses the sticky comment for a normal pull_request event", async () => {
    const ctx = makeContext("pull_request");
    const octokit = makeOctokit({
      id: 999,
      body: "<!-- garda-code-action-comment -->\nold",
    });

    const result = await createOrUpdateTrackingComment(
      octokit,
      ctx,
      null,
      "working",
    );

    expect(octokit.rest.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 999 }),
    );
    expect(
      octokit.rest.pulls.createReplyForReviewComment,
    ).not.toHaveBeenCalled();
    expect(result?.kind).toBe("issue");
  });

  it("updates the same review thread on subsequent calls", async () => {
    const ctx = makeContext("pull_request_review_comment", 555);
    const octokit = makeOctokit();

    const result = await createOrUpdateTrackingComment(
      octokit,
      ctx,
      { id: 3003, kind: "review" },
      "more progress",
    );

    expect(octokit.rest.pulls.updateReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 3003 }),
    );
    expect(result?.kind).toBe("review");
  });
});
