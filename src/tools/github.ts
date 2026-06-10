import { z } from "zod";
import type { GitHubClient } from "../github/types.js";
import type { NeoTool, InlineComment } from "./types.js";
import { createOrUpdateTrackingComment } from "../github/comments.js";
import { redact } from "../utils/redact.js";
import { truncateText } from "../utils/text.js";

function findChangedFile(
  files: { filename: string; patch?: string }[],
  path: string,
) {
  return files.find((file) => file.filename === path);
}

/**
 * Parse the set of RIGHT-side (new file) line numbers that appear in a unified
 * diff patch. GitHub only accepts inline comments on lines present in the diff,
 * so we validate the requested line against parsed hunk ranges instead of
 * blindly trusting any positive integer.
 */
export function rightSideLinesInPatch(patch?: string): Set<number> {
  const lines = new Set<number>();
  if (!patch) return lines;
  let newLine = 0;
  for (const row of patch.split("\n")) {
    const hunk = row.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk && hunk[1]) {
      newLine = Number.parseInt(hunk[1], 10);
      continue;
    }
    if (row.startsWith("+")) {
      // Added line — commentable on RIGHT side
      lines.add(newLine);
      newLine += 1;
    } else if (row.startsWith("-")) {
      // Removed line — does not advance new-file counter
    } else if (!row.startsWith("\\")) {
      // Context line — advances new-file counter, also commentable
      lines.add(newLine);
      newLine += 1;
    }
  }
  return lines;
}

function isLineInPatch(file: { patch?: string }, line: number): boolean {
  if (!Number.isInteger(line) || line <= 0) return false;
  // If no patch is available (binary, too large), stay lenient and let the
  // GitHub API do final validation.
  if (!file.patch) return true;
  const validLines = rightSideLinesInPatch(file.patch);
  // Empty parse result (unexpected patch format) — fall back to lenient.
  if (validLines.size === 0) return true;
  return validLines.has(line);
}

export const githubTools: NeoTool[] = [
  {
    name: "github_update_tracking_comment",
    description:
      "Update the single Garda Code progress/comment on the issue or pull request.",
    schema: z.object({ status: z.string(), body: z.string().optional() }),
    readonly: false,
    async execute(args, ctx) {
      const parsed = this.schema.parse(args) as {
        status: string;
        body?: string;
      };
      const comment = await createOrUpdateTrackingComment(
        ctx.octokit,
        ctx.github,
        ctx.trackingComment,
        parsed.status,
        parsed.body || "",
      );
      ctx.setTrackingComment(comment);
      return { updated: Boolean(comment?.id), url: comment?.html_url };
    },
  },
  {
    name: "github_buffer_inline_comment",
    description:
      "Buffer an inline PR comment candidate. The action validates and posts buffered comments at the end. " +
      "For applicable fixes, include a GitHub suggestion block in the body so the PR author can apply it in one click:\n" +
      "```suggestion\n<replacement code for the commented line range>\n```\n" +
      "The suggestion replaces the ENTIRE line range (single `line`, or `start_line` to `line`). " +
      "Ensure the replacement is syntactically complete and correctly indented.",
    schema: z.object({
      path: z.string(),
      line: z.number(),
      body: z.string(),
      side: z.enum(["RIGHT", "LEFT"]).optional(),
      start_line: z.number().optional(),
      start_side: z.enum(["RIGHT", "LEFT"]).optional(),
      confirmed: z.boolean().optional(),
    }),
    readonly: false,
    async execute(args, ctx) {
      if (!ctx.github.config.inlineComments)
        return { skipped: "inline_comments=false" };
      if (!ctx.github.isPR) return { skipped: "not a pull request" };
      const parsed = this.schema.parse(args) as InlineComment;
      if (
        parsed.confirmed === false &&
        !ctx.github.config.classifyInlineComments
      )
        return { skipped: "confirmed=false" };
      const changed = findChangedFile(ctx.data.changedFiles, parsed.path);
      if (!changed)
        return { skipped: `path is not in changed files: ${parsed.path}` };
      if (!isLineInPatch(changed, parsed.line))
        return {
          skipped: `line is not valid for diff: ${parsed.path}:${parsed.line}`,
        };
      if (ctx.inlineBuffer.length >= ctx.github.config.maxInlineComments)
        return { skipped: "max_inline_comments reached" };
      ctx.inlineBuffer.push({
        ...parsed,
        body: redact(parsed.body),
        side: parsed.side || "RIGHT",
      });
      return { buffered: true, total: ctx.inlineBuffer.length };
    },
  },
  {
    name: "github_get_workflow_run_details",
    description:
      "Get detailed info for a GitHub Actions workflow run including jobs, steps, and annotations. Requires actions:read.",
    schema: z.object({
      run_id: z.number(),
    }),
    readonly: true,
    async execute(args, ctx) {
      const parsed = this.schema.parse(args) as { run_id: number };
      const { owner, repo } = ctx.github.repository;
      const [runRes, jobsRes] = await Promise.all([
        ctx.octokit.rest.actions.getWorkflowRun({
          owner,
          repo,
          run_id: parsed.run_id,
        }),
        ctx.octokit.rest.actions.listJobsForWorkflowRun({
          owner,
          repo,
          run_id: parsed.run_id,
          per_page: 30,
        }),
      ]);
      return {
        run: {
          id: runRes.data.id,
          name: runRes.data.name,
          status: runRes.data.status,
          conclusion: runRes.data.conclusion,
          html_url: runRes.data.html_url,
          created_at: runRes.data.created_at,
          updated_at: runRes.data.updated_at,
        },
        jobs: jobsRes.data.jobs.map((job) => ({
          id: job.id,
          name: job.name,
          status: job.status,
          conclusion: job.conclusion,
          html_url: job.html_url,
          steps: (job.steps || []).slice(0, 20).map((s) => ({
            name: s.name,
            status: s.status,
            conclusion: s.conclusion,
            number: s.number,
          })),
        })),
      };
    },
  },
  {
    name: "github_get_ci_status",
    description:
      "Return fetched CI/check status for the pull request head SHA.",
    schema: z.object({}),
    readonly: true,
    async execute(_args, ctx) {
      return ctx.data.ciStatus || { status: "unavailable" };
    },
  },
  {
    name: "github_download_job_log",
    description:
      "Download a GitHub Actions job log by job_id. Requires actions:read permission.",
    schema: z.object({ job_id: z.number(), max_chars: z.number().optional() }),
    readonly: true,
    async execute(args, ctx) {
      const parsed = this.schema.parse(args) as {
        job_id: number;
        max_chars?: number;
      };
      const response =
        await ctx.octokit.rest.actions.downloadJobLogsForWorkflowRun({
          owner: ctx.github.repository.owner,
          repo: ctx.github.repository.repo,
          job_id: parsed.job_id,
        });
      const text =
        typeof response.data === "string"
          ? response.data
          : JSON.stringify(response.data);
      const max = parsed.max_chars ?? 30000;
      return redact(truncateText(text, max));
    },
  },
  {
    name: "github_create_summary_comment",
    description:
      "Create a normal issue/PR comment. Use sparingly; prefer updating the tracking comment.",
    schema: z.object({ body: z.string() }),
    readonly: false,
    async execute(args, ctx) {
      if (ctx.github.config.dryRun) return { dry_run: true };
      if (!ctx.github.isEntity || !ctx.github.entityNumber)
        return { skipped: "not an entity event" };
      const parsed = this.schema.parse(args) as { body: string };
      const { data } = await ctx.octokit.rest.issues.createComment({
        owner: ctx.github.repository.owner,
        repo: ctx.github.repository.repo,
        issue_number: ctx.github.entityNumber,
        body: parsed.body,
      });
      return { id: data.id, url: data.html_url };
    },
  },
];

function looksLikeProbeComment(body: string): boolean {
  const normalized = body.trim().toLowerCase();
  if (!normalized) return true;
  const probePatterns = [
    /^test comment\b/,
    /^testing\b/,
    /^checking if\b/,
    /^can i (post|comment|create)/,
    /^does this work\b/,
    /^probe\b/,
    /^placeholder\b/,
    /tool.*(works|test|probe)/,
  ];
  return probePatterns.some((pattern) => pattern.test(normalized));
}

function addFixHint(
  ctx: import("../github/context.js").NeoContext,
  body: string,
): string {
  if (!ctx.config.includeFixLinks || ctx.config.mode === "fix") return body;
  return `${body}

<sub>Need a patch? Reply with \`${ctx.config.triggerPhrase} fix this\`.</sub>`;
}

function reviewCommentPayload(
  ctx: import("../github/context.js").NeoContext,
  comment: InlineComment,
) {
  return {
    body: addFixHint(ctx, comment.body),
    path: comment.path,
    line: comment.line,
    side: comment.side || "RIGHT",
    ...(comment.start_line ? { start_line: comment.start_line } : {}),
    ...(comment.start_side ? { start_side: comment.start_side } : {}),
  };
}

function shouldPostComment(
  ctx: import("../github/context.js").NeoContext,
  comment: InlineComment,
): boolean {
  if (!ctx.config.classifyInlineComments) return comment.confirmed !== false;
  if (comment.confirmed === false) return false;
  if (looksLikeProbeComment(comment.body)) return false;
  return true;
}

async function postBatchReview(
  octokit: GitHubClient,
  ctx: import("../github/context.js").NeoContext,
  comments: InlineComment[],
): Promise<{ posted: number; skipped: number; reviewUrl?: string }> {
  if (!ctx.entityNumber) return { posted: 0, skipped: comments.length };
  const commitId = ctx.headSha || ctx.payload.pull_request?.head?.sha;
  if (!commitId) return { posted: 0, skipped: comments.length };
  const reviewComments = comments.map((comment) =>
    reviewCommentPayload(ctx, comment),
  );
  if (reviewComments.length === 0) return { posted: 0, skipped: 0 };
  const { data } = await octokit.rest.pulls.createReview({
    owner: ctx.repository.owner,
    repo: ctx.repository.repo,
    pull_number: ctx.entityNumber,
    commit_id: commitId,
    event: "COMMENT",
    body: "Garda Code review findings.",
    comments: reviewComments,
  });
  return {
    posted: reviewComments.length,
    skipped: 0,
    reviewUrl: data.html_url,
  };
}

async function postIndividualComments(
  octokit: GitHubClient,
  ctx: import("../github/context.js").NeoContext,
  comments: InlineComment[],
): Promise<{ posted: number; skipped: number }> {
  let posted = 0;
  let skipped = 0;
  if (!ctx.entityNumber) return { posted: 0, skipped: comments.length };
  const commitId = ctx.headSha || ctx.payload.pull_request?.head?.sha;
  if (!commitId) return { posted: 0, skipped: comments.length };
  for (const comment of comments) {
    try {
      await octokit.rest.pulls.createReviewComment({
        owner: ctx.repository.owner,
        repo: ctx.repository.repo,
        pull_number: ctx.entityNumber,
        commit_id: commitId,
        ...reviewCommentPayload(ctx, comment),
      });
      posted += 1;
    } catch {
      skipped += 1;
    }
  }
  return { posted, skipped };
}

export async function postBufferedInlineComments(
  octokit: GitHubClient,
  ctx: import("../github/context.js").NeoContext,
  comments: InlineComment[],
): Promise<{ posted: number; skipped: number; reviewUrl?: string }> {
  if (
    !ctx.isPR ||
    !ctx.entityNumber ||
    !ctx.config.inlineComments ||
    ctx.config.dryRun
  )
    return { posted: 0, skipped: comments.length };
  const selected = comments.slice(0, ctx.config.maxInlineComments);
  const postable = selected.filter((comment) =>
    shouldPostComment(ctx, comment),
  );
  const skippedByFilter =
    selected.length -
    postable.length +
    Math.max(0, comments.length - selected.length);
  if (postable.length === 0) return { posted: 0, skipped: skippedByFilter };

  if (ctx.config.batchInlineComments) {
    try {
      const batch = await postBatchReview(octokit, ctx, postable);
      return {
        posted: batch.posted,
        skipped: skippedByFilter + batch.skipped,
        reviewUrl: batch.reviewUrl,
      };
    } catch {
      const individual = await postIndividualComments(octokit, ctx, postable);
      return {
        posted: individual.posted,
        skipped: skippedByFilter + individual.skipped,
      };
    }
  }

  const individual = await postIndividualComments(octokit, ctx, postable);
  return {
    posted: individual.posted,
    skipped: skippedByFilter + individual.skipped,
  };
}
