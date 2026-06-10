import { minimatch } from "minimatch";
import { splitList } from "../utils/text.js";
import { redact } from "../utils/redact.js";
import { sanitizeContent } from "../utils/sanitize.js";
import type { NeoContext } from "./context.js";
import type {
  CiStatus,
  CommentLike,
  EntityLike,
  GitHubClient,
  ReviewLike,
} from "./types.js";
import {
  downloadCommentImages,
  type DownloadedCommentImage,
  type ImageSource,
} from "./image-downloader.js";

export type ChangedFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  sha?: string | null;
  patch?: string;
  raw_url?: string;
  blob_url?: string;
  previous_filename?: string;
};

export type GitHubData = {
  entity: EntityLike;
  comments: CommentLike[];
  reviewComments: CommentLike[];
  reviews: ReviewLike[];
  changedFiles: ChangedFile[];
  diff: string;
  ciStatus: CiStatus | null;
  commentImages: DownloadedCommentImage[];
  triggerDisplayName?: string;
};

type Timestamped = {
  created_at?: string | null;
  updated_at?: string | null;
  submitted_at?: string | null;
};

export function shouldIgnore(path: string, ignoreInput: string): boolean {
  const patterns = splitList(ignoreInput);
  return patterns.some((pattern) =>
    minimatch(path, pattern, { dot: true, nocase: false }),
  );
}

function actorAllowed(
  login: string,
  include: string,
  exclude: string,
): boolean {
  const includes = splitList(include);
  const excludes = splitList(exclude);
  const match = (pattern: string) =>
    minimatch(login, pattern, { nocase: true }) || pattern === login;
  if (excludes.some(match)) return false;
  if (includes.length === 0) return true;
  return includes.some(match);
}

function triggerTimestamp(context: NeoContext): string | undefined {
  if (context.eventName === "issue_comment")
    return context.payload.comment?.created_at || undefined;
  if (context.eventName === "pull_request_review_comment")
    return context.payload.comment?.created_at || undefined;
  if (context.eventName === "pull_request_review")
    return context.payload.review?.submitted_at || undefined;
  return undefined;
}

function createdAt(item: Timestamped): string | undefined {
  return item.created_at || item.submitted_at || undefined;
}

/**
 * Claude Code Action filters comments/reviews to their state before the trigger
 * timestamp. Without this, another actor can edit/add comments after an
 * authorized trigger and inject instructions into the context before the model
 * runs. REST timestamps are less rich than Claude's GraphQL lastEditedAt, so we
 * use created_at/submitted_at and updated_at as a conservative best effort.
 */
function existedBeforeTrigger<T extends Timestamped>(
  items: T[],
  context: NeoContext,
): T[] {
  const trigger = triggerTimestamp(context);
  if (!trigger) return items;
  const triggerMs = new Date(trigger).getTime();
  if (!Number.isFinite(triggerMs)) return items;
  return items.filter((item) => {
    const created = createdAt(item);
    if (!created) return false;
    const createdMs = new Date(created).getTime();
    if (!Number.isFinite(createdMs) || createdMs >= triggerMs) return false;
    if (item.updated_at) {
      const updatedMs = new Date(item.updated_at).getTime();
      if (Number.isFinite(updatedMs) && updatedMs >= triggerMs) return false;
    }
    return true;
  });
}

function sanitizeComment<T extends CommentLike>(comment: T): T {
  return { ...comment, body: sanitizeContent(comment.body || "") };
}

/**
 * TOCTOU guard for the entity body/title. An attacker can trigger Garda via an
 * authorized user's comment, then edit the issue/PR body to inject instructions
 * before we fetch it. If the fetched entity was updated at/after the trigger
 * timestamp, prefer the webhook payload body (frozen at event time) and drop a
 * security warning. Mirrors Claude Code Action's isBodySafeToUse.
 */
function safeEntityBody(
  context: NeoContext,
  fetched: EntityLike,
): { title: string; body: string } {
  const trigger = triggerTimestamp(context);
  const payloadEntity = context.isPR
    ? context.payload.pull_request
    : context.payload.issue;
  const fetchedTitle = fetched.title || "";
  const fetchedBody = fetched.body || "";

  if (!trigger) return { title: fetchedTitle, body: fetchedBody };

  const triggerMs = new Date(trigger).getTime();
  const updatedMs = fetched.body
    ? new Date((fetched as { updated_at?: string }).updated_at || 0).getTime()
    : 0;

  if (
    Number.isFinite(triggerMs) &&
    Number.isFinite(updatedMs) &&
    updatedMs >= triggerMs
  ) {
    // Entity was edited at/after the trigger — use the frozen payload version.
    const safeTitle = payloadEntity?.title ?? fetchedTitle;
    const safeBody = payloadEntity?.body ?? "";
    // Only warn when content actually differs.
    if (safeBody !== fetchedBody || safeTitle !== fetchedTitle) {
      // eslint-disable-next-line no-console
      console.warn(
        "::warning::Entity body/title was edited at/after the trigger time. Using the webhook payload version to prevent post-trigger injection.",
      );
    }
    return { title: safeTitle, body: safeBody };
  }

  return { title: fetchedTitle, body: fetchedBody };
}

function sanitizeEntity<T extends EntityLike>(
  entity: T,
  context?: NeoContext,
): T {
  const safe = context
    ? safeEntityBody(context, entity)
    : { title: entity.title || "", body: entity.body || "" };
  return {
    ...entity,
    title: sanitizeContent(safe.title),
    body: sanitizeContent(safe.body),
  };
}

function triggerImageSource(context: NeoContext): ImageSource | undefined {
  if (context.eventName === "issue_comment" && context.payload.comment?.id) {
    return {
      type: "trigger_comment",
      id: String(context.payload.comment.id),
      body: context.payload.comment.body || "",
      issueNumber: context.entityNumber,
    };
  }
  if (
    context.eventName === "pull_request_review_comment" &&
    context.payload.comment?.id
  ) {
    return {
      type: "review_comment",
      id: String(context.payload.comment.id),
      body: context.payload.comment.body || "",
      pullNumber: context.entityNumber,
    };
  }
  if (
    context.eventName === "pull_request_review" &&
    context.payload.review?.id
  ) {
    return {
      type: "review_body",
      id: String(context.payload.review.id),
      body: context.payload.review.body || "",
      pullNumber: context.entityNumber,
    };
  }
  return undefined;
}

function commentImageSources(
  context: NeoContext,
  entity: EntityLike,
  comments: CommentLike[],
  reviewComments: CommentLike[],
): ImageSource[] {
  const sources: ImageSource[] = [];
  const trigger = triggerImageSource(context);
  if (trigger) sources.push(trigger);
  if (context.isPR) {
    sources.push({
      type: "pr_body",
      id: String(context.entityNumber || ""),
      pullNumber: context.entityNumber,
      body: entity?.body || "",
    });
  } else if (context.isEntity) {
    sources.push({
      type: "issue_body",
      id: String(context.entityNumber || ""),
      issueNumber: context.entityNumber,
      body: entity?.body || "",
    });
  }
  for (const comment of comments) {
    if (comment?.id && comment?.body) {
      sources.push({
        type: "issue_comment",
        id: String(comment.id),
        issueNumber: context.entityNumber,
        body: comment.body,
      });
    }
  }
  for (const comment of reviewComments) {
    if (comment?.id && comment?.body) {
      sources.push({
        type: "review_comment",
        id: String(comment.id),
        pullNumber: context.entityNumber,
        body: comment.body,
      });
    }
  }
  return sources;
}

async function paginate<T>(
  fn: (options: { per_page: number; page: number }) => Promise<{ data: T[] }>,
  maxPages = 10,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const { data } = await fn({ per_page: 100, page });
    out.push(...data);
    if (data.length < 100) break;
  }
  return out;
}

export async function fetchGitHubData(
  octokit: GitHubClient,
  context: NeoContext,
): Promise<GitHubData> {
  if (!context.isEntity || !context.entityNumber) {
    return {
      entity: context.payload,
      comments: [],
      reviewComments: [],
      reviews: [],
      changedFiles: [],
      diff: "",
      ciStatus: null,
      commentImages: [],
    };
  }

  const owner = context.repository.owner;
  const repo = context.repository.repo;
  const issue_number = context.entityNumber;
  const number = context.entityNumber;

  const comments = await paginate<CommentLike>(
    (p) =>
      octokit.rest.issues.listComments({ owner, repo, issue_number, ...p }),
    5,
  );
  const filteredComments = existedBeforeTrigger(comments, context)
    .filter((comment) => !comment.is_minimized)
    .filter((comment) =>
      actorAllowed(
        comment.user?.login || "",
        context.config.includeCommentsByActor,
        context.config.excludeCommentsByActor,
      ),
    )
    .map(sanitizeComment);

  if (!context.isPR) {
    const { data: issue } = await octokit.rest.issues.get({
      owner,
      repo,
      issue_number,
    });
    const sanitizedIssue = sanitizeEntity(issue, context);
    const commentImages = await downloadCommentImages(
      octokit,
      context,
      commentImageSources(context, issue, filteredComments, []),
    );
    return {
      entity: sanitizedIssue,
      comments: filteredComments,
      reviewComments: [],
      reviews: [],
      changedFiles: [],
      diff: "",
      ciStatus: null,
      commentImages,
    };
  }

  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: number,
  });
  const files = await paginate<ChangedFile>(
    (p) =>
      octokit.rest.pulls.listFiles({ owner, repo, pull_number: number, ...p }),
    10,
  );
  const changedFiles = files.filter(
    (file) => !shouldIgnore(file.filename, context.config.ignore),
  );
  const reviewComments = await paginate<CommentLike>(
    (p) =>
      octokit.rest.pulls.listReviewComments({
        owner,
        repo,
        pull_number: number,
        ...p,
      }),
    5,
  );
  const filteredReviewComments = existedBeforeTrigger(reviewComments, context)
    .filter((comment) => !comment.is_minimized)
    .filter((comment) =>
      actorAllowed(
        comment.user?.login || "",
        context.config.includeCommentsByActor,
        context.config.excludeCommentsByActor,
      ),
    )
    .map(sanitizeComment);

  // Top-level PR reviews (APPROVED / CHANGES_REQUESTED / COMMENTED + body).
  // Important context for fix mode responding to reviewer feedback cycles.
  const reviews = await paginate<ReviewLike>(
    (p) =>
      octokit.rest.pulls.listReviews({
        owner,
        repo,
        pull_number: number,
        ...p,
      }),
    5,
  );
  const filteredReviews = existedBeforeTrigger(reviews, context)
    .filter((review) =>
      actorAllowed(
        review.user?.login || "",
        context.config.includeCommentsByActor,
        context.config.excludeCommentsByActor,
      ),
    )
    .filter((review) => (review.body || "").trim().length > 0)
    .map((review) => ({
      ...review,
      body: sanitizeContent(review.body || ""),
    }));

  let diff = changedFiles
    .map((file) => {
      const patch = file.patch || "[binary or patch unavailable]";
      const shaLine = file.sha ? `sha: ${file.sha}\n` : "";
      return `diff -- ${sanitizeContent(file.filename)}\nstatus: ${sanitizeContent(file.status)} +${file.additions}/-${file.deletions}\n${shaLine}${sanitizeContent(patch)}`;
    })
    .join("\n\n");
  diff = redact(diff);
  if (diff.length > context.config.maxDiffChars)
    diff = `${diff.slice(0, context.config.maxDiffChars)}\n\n[... diff truncated ...]`;

  let ciStatus: CiStatus | null = null;
  try {
    const { data } = await octokit.rest.checks.listForRef({
      owner,
      repo,
      ref: pr.head.sha,
      per_page: 100,
    });
    ciStatus = {
      total: data.total_count,
      runs: data.check_runs.map((run) => ({
        id: run.id,
        name: sanitizeContent(run.name),
        status: run.status,
        conclusion: run.conclusion,
        html_url: run.html_url,
      })),
    };
  } catch {
    ciStatus = null;
  }

  const sanitizedPr = sanitizeEntity(pr, context);
  const commentImages = await downloadCommentImages(
    octokit,
    context,
    commentImageSources(context, pr, filteredComments, filteredReviewComments),
  );

  let triggerDisplayName: string | undefined;
  try {
    const { data: user } = await octokit.rest.users.getByUsername({
      username: context.actor,
    });
    triggerDisplayName = user.name || user.login || undefined;
  } catch {
    // Non-critical — commit attribution still works without display name
  }

  return {
    entity: sanitizedPr,
    comments: filteredComments,
    reviewComments: filteredReviewComments,
    reviews: filteredReviews,
    changedFiles,
    diff,
    ciStatus,
    commentImages,
    triggerDisplayName,
  };
}

export function formatGitHubContext(
  context: NeoContext,
  data: GitHubData,
): string {
  const lines: string[] = [];
  lines.push(`Repository: ${context.repository.fullName}`);
  lines.push(
    `Event: ${context.eventName}${context.eventAction ? `.${context.eventAction}` : ""}`,
  );
  lines.push(`Actor: ${context.actor}`);

  // Surface the trigger comment's location so "@garda fix this" on a specific
  // PR line tells the model exactly which file/line the user is pointing at.
  if (
    context.eventName === "pull_request_review_comment" &&
    context.payload.comment?.path
  ) {
    const c = context.payload.comment;
    lines.push(
      "\n=== TRIGGER COMMENT LOCATION (the user is referring to this exact line) ===",
    );
    lines.push(
      `File: ${sanitizeContent(c.path || "")}:${c.line || c.original_line || "?"}`,
    );
    if (c.diff_hunk)
      lines.push(`Diff hunk context:\n${sanitizeContent(c.diff_hunk)}`);
    lines.push("=== END TRIGGER LOCATION ===");
  }

  if (context.isPR) {
    lines.push(
      `Pull Request: #${context.entityNumber} ${sanitizeContent(data.entity.title || "")}`,
    );
    lines.push(
      `Author: ${data.entity.user?.login || data.entity.author?.login || "unknown"}`,
    );
    lines.push(
      `Branch: ${data.entity.head?.ref || "?"} -> ${data.entity.base?.ref || "?"}`,
    );
    lines.push(`Head SHA: ${data.entity.head?.sha || "?"}`);
    lines.push(`Changed files: ${data.changedFiles.length}`);
    lines.push("Changed file list:");
    for (const file of data.changedFiles)
      lines.push(
        `- ${sanitizeContent(file.filename)} (${sanitizeContent(file.status)}) +${file.additions}/-${file.deletions}`,
      );
  } else if (context.isEntity) {
    lines.push(
      `Issue: #${context.entityNumber} ${sanitizeContent(data.entity.title || "")}`,
    );
    lines.push(`Author: ${data.entity.user?.login || "unknown"}`);
  }

  if (data.comments.length) {
    lines.push("\nPrior issue/PR comments before the trigger:");
    for (const comment of data.comments.slice(-20)) {
      lines.push(
        `[${comment.user?.login || "unknown"} at ${comment.created_at}]: ${sanitizeContent(comment.body || "")}`,
      );
    }
  }
  if (data.reviews?.length) {
    lines.push("\nPrior PR reviews before the trigger:");
    for (const review of data.reviews.slice(-10)) {
      lines.push(
        `[Review by ${review.user?.login || "unknown"} at ${review.submitted_at} — ${review.state || "COMMENTED"}]: ${sanitizeContent(review.body || "")}`,
      );
    }
  }
  if (data.reviewComments.length) {
    lines.push("\nPrior review comments before the trigger:");
    for (const comment of data.reviewComments.slice(-20)) {
      lines.push(
        `[${comment.user?.login || "unknown"} on ${sanitizeContent(comment.path)}:${comment.line || comment.original_line || "?"}]: ${sanitizeContent(comment.body || "")}`,
      );
    }
  }
  if (data.commentImages.length) {
    lines.push("\nDownloaded GitHub user-attachment images:");
    for (const image of data.commentImages) {
      lines.push(
        `- ${image.sourceType} ${image.sourceId}: ${image.mimeType}, ${image.bytes} bytes, local ${sanitizeContent(image.localPath)}`,
      );
    }
  }
  if (data.ciStatus)
    lines.push(
      `\nCI status: ${sanitizeContent(JSON.stringify(data.ciStatus, null, 2))}`,
    );
  if (data.diff) lines.push(`\nUnified diff:\n${data.diff}`);
  return lines.join("\n");
}
