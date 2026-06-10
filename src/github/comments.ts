import type { NeoContext } from "./context.js";
import type { CommentLike, GitHubClient } from "./types.js";

const MARKER = "<!-- garda-code-action-comment -->";
const SPINNER_HTML =
  '<img src="https://raw.githubusercontent.com/neosantara-xyz/garda-code-action/main/assets/garda-spinner.gif" width="14px" height="14px" style="vertical-align: middle; margin-left: 4px;" />';

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

/**
 * Strip any Garda-rendered scaffolding (marker, working-title + spinner line,
 * and trailing workflow-run link) that the model may have echoed back into the
 * status/body it passes to github_update_tracking_comment. Without this, the
 * model occasionally includes the title in its own text and renderProgress
 * wraps it again, producing a duplicated "Garda Code sedang bekerja…" header.
 */
function stripScaffolding(text: string): string {
  if (!text) return "";
  let out = text;
  // Remove the HTML marker comment.
  out = out.replace(/<!--\s*garda-code-action-comment\s*-->/g, "");
  // Remove any "### Garda Code is working… <img .../>" (or Indonesian) heading,
  // including a bare title line without the spinner.
  out = out.replace(
    /^#{0,6}\s*Garda Code (sedang bekerja|is working)…?.*$/gim,
    "",
  );
  // Remove any inline spinner image tags.
  out = out.replace(/<img[^>]*garda-spinner\.gif[^>]*>/gi, "");
  // Remove trailing "[View workflow run](...)" links — re-added once below.
  out = out.replace(/\[View workflow run\]\([^)]*\)/g, "");
  return out.trim();
}

export function renderProgress(
  context: NeoContext,
  status: string,
  body = "",
): string {
  const title = context.config.reviewLanguage.toLowerCase().startsWith("id")
    ? "Garda Code sedang bekerja"
    : "Garda Code is working";
  const cleanStatus = stripScaffolding(status);
  const cleanBody = stripScaffolding(body);
  return `${MARKER}\n### ${title}… ${SPINNER_HTML}\n\n${cleanStatus}\n\n${cleanBody ? `${cleanBody}\n\n` : ""}[View workflow run](${context.runUrl})`;
}

const TITLE_PATTERNS = [
  /Garda Code (sedang bekerja|is working)/i,
  /\*\*Garda (finished|encountered an error)/i,
];

function looksLikeGardaComment(body: string | null | undefined): boolean {
  if (!body) return false;
  if (body.includes(MARKER)) return true;
  return TITLE_PATTERNS.some((p) => p.test(body));
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
        looksLikeGardaComment(comment.body) && isBotComment(comment, context),
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
  const sticky =
    context.config.useStickyComment &&
    context.eventName !== "pull_request_review_comment"
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
  // Only append the workflow-run link when the body does not already include
  // it (the final completion comment carries it in its action bar). This avoids
  // a duplicate "View workflow run" line.
  const alreadyHasRunLink = body.includes(context.runUrl);
  const rendered = alreadyHasRunLink
    ? `${MARKER}\n${body}`
    : `${MARKER}\n${body}\n\n[View workflow run](${context.runUrl})`;
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
