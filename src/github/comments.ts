import type { NeoContext } from "./context.js";
import type { CommentLike, GitHubClient } from "./types.js";

const MARKER = "<!-- garda-code-action-comment -->";
const SPINNER_HTML =
  '<img src="https://github.com/user-attachments/assets/5ac382c7-e004-429b-8e35-7feb3e8f9c6f" width="14px" height="14px" style="vertical-align: middle; margin-left: 4px;" />';

// Numeric GitHub App bot IDs for reliable sticky comment matching.
const GARDA_BOT_APP_IDS = new Set([209825114]);

export type TrackingComment = {
  id: number;
  html_url?: string;
  kind?: "issue" | "review";
} | null;

function isBotComment(comment: CommentLike, context: NeoContext): boolean {
  const login = String(comment.user?.login || "").toLowerCase();
  const type = String(comment.user?.type || "").toLowerCase();
  const botName = String(context.config.botName || "").toLowerCase();
  const userId = (comment.user as any)?.id;
  if (userId && GARDA_BOT_APP_IDS.has(userId)) return true;
  return (
    type === "bot" ||
    login === botName ||
    login === "github-actions[bot]" ||
    login === "neo-code[bot]" ||
    login === "neosantara-ai[bot]"
  );
}

export function renderProgress(
  context: NeoContext,
  status: string,
  body = "",
): string {
  const title = context.config.reviewLanguage.toLowerCase().startsWith("id")
    ? "Garda Code sedang bekerja"
    : "Garda Code is working";
  return `${MARKER}\n### ${title}… ${SPINNER_HTML}\n\n${status}\n\n${body ? `${body}\n\n` : ""}[View workflow run](${context.runUrl})`;
}

export async function findStickyComment(
  octokit: GitHubClient,
  context: NeoContext,
): Promise<TrackingComment> {
  if (!context.isEntity || !context.entityNumber) return null;
  const { owner, repo } = context.repository;
  const { data } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: context.entityNumber,
    per_page: 100,
  });
  const found = [...data]
    .reverse()
    .find(
      (comment: CommentLike) =>
        comment.body?.includes(MARKER) && isBotComment(comment, context),
    );
  return found
    ? { id: found.id, html_url: found.html_url, kind: "issue" }
    : null;
}

export async function createOrUpdateTrackingComment(
  octokit: GitHubClient,
  context: NeoContext,
  existing: TrackingComment,
  status: string,
  body = "",
): Promise<TrackingComment> {
  if (
    !context.config.trackProgress ||
    !context.isEntity ||
    !context.entityNumber ||
    context.config.dryRun
  )
    return existing;
  const { owner, repo } = context.repository;
  const rendered = renderProgress(context, status, body);
  if (existing?.id) {
    const kind = existing.kind || "issue";
    if (kind === "review") {
      const { data } = await octokit.rest.pulls.updateReviewComment({
        owner,
        repo,
        comment_id: existing.id,
        body: rendered,
      });
      return { id: data.id, html_url: data.html_url, kind };
    }
    const { data } = await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body: rendered,
    });
    return { id: data.id, html_url: data.html_url, kind };
  }
  const sticky = context.config.useStickyComment
    ? await findStickyComment(octokit, context)
    : null;
  if (sticky?.id) {
    const { data } = await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: sticky.id,
      body: rendered,
    });
    return { id: data.id, html_url: data.html_url, kind: "issue" };
  }
  if (
    context.eventName === "pull_request_review_comment" &&
    context.payload.comment?.id
  ) {
    const { data } = await octokit.rest.pulls.createReplyForReviewComment({
      owner,
      repo,
      pull_number: context.entityNumber,
      comment_id: context.payload.comment.id,
      body: rendered,
    });
    return { id: data.id, html_url: data.html_url, kind: "review" };
  }
  const { data } = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: context.entityNumber,
    body: rendered,
  });
  return { id: data.id, html_url: data.html_url, kind: "issue" };
}

export async function updateTrackingComment(
  octokit: GitHubClient,
  context: NeoContext,
  comment: TrackingComment,
  body: string,
): Promise<void> {
  if (!comment?.id || context.config.dryRun) return;
  const rendered = `${MARKER}\n${body}\n\n[View workflow run](${context.runUrl})`;
  if (comment.kind === "review") {
    await octokit.rest.pulls.updateReviewComment({
      owner: context.repository.owner,
      repo: context.repository.repo,
      comment_id: comment.id,
      body: rendered,
    });
    return;
  }
  await octokit.rest.issues.updateComment({
    owner: context.repository.owner,
    repo: context.repository.repo,
    comment_id: comment.id,
    body: rendered,
  });
}
