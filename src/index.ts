import * as core from "@actions/core";
import * as github from "@actions/github";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { readConfig, type ActionConfig } from "./config.js";
import { resolveGitHubToken } from "./github/token.js";
import { parseContext, type NeoContext } from "./github/context.js";
import { detectExecutionMode } from "./modes/detector.js";
import { containsTrigger, extractUserRequest } from "./github/trigger.js";
import {
  validateActorAndPermissions,
  assertFixAllowed,
} from "./github/permissions.js";
import { restoreTrustedConfigFromBase } from "./github/trusted-config.js";
import {
  hydratePullRequestContext,
  preparePullRequestWorkspace,
  prepareIssueWorkspace,
} from "./github/workspace.js";
import { fetchGitHubData, formatGitHubContext } from "./github/data.js";
import {
  createOrUpdateTrackingComment,
  updateTrackingComment,
  type TrackingComment,
} from "./github/comments.js";
import { createNeosantaraClient } from "./neosantara/client.js";
import { buildSystemPrompt, buildTaskPrompt } from "./prompt/system.js";
import { runNeoAgent } from "./neosantara/runner.js";
import { classifyBufferedInlineComments } from "./neosantara/inline-classifier.js";
import { postBufferedInlineComments } from "./tools/github.js";
import {
  finalizeCreatedBranch,
  type BranchFinalization,
} from "./github/branch-cleanup.js";
import type { InlineComment } from "./tools/types.js";
import type { GitHubClient } from "./github/types.js";

async function writeExecutionTranscript(
  context: NeoContext,
  result: Awaited<ReturnType<typeof runNeoAgent>>,
  inlineStats: { posted: number; skipped: number; reviewUrl?: string },
  branchFinalization: BranchFinalization,
  commentImages: Array<{
    sourceType: string;
    sourceId: string;
    originalUrl: string;
    localPath: string;
    mimeType: string;
    bytes: number;
  }>,
): Promise<string> {
  const dir = process.env.RUNNER_TEMP || process.cwd();
  await mkdir(dir, { recursive: true });
  const file = join(
    dir,
    `garda-code-execution-${context.runId || "local"}.json`,
  );
  const payload = {
    repository: context.repository.fullName,
    event: `${context.eventName}${context.eventAction ? `.${context.eventAction}` : ""}`,
    actor: context.actor,
    mode: context.config.mode,
    response_id: result.responseId || null,
    branch_name: context.workingBranch || null,
    inline_comments: inlineStats,
    branch_finalization: branchFinalization,
    comment_images: commentImages,
    usage: result.usage || null,
    transcript: result.transcript,
  };
  await writeFile(file, JSON.stringify(payload, null, 2));
  return file;
}

function addBranchLinks(
  context: NeoContext,
  body: string,
  branch: BranchFinalization,
): string {
  if (!context.createdBranch && !branch.branchName) return body;
  if (branch.deleted) {
    return `${body}\n\n**Branch**: \`${branch.branchName}\` was deleted because no changes were committed.\n`;
  }
  if (!branch.hasChanges || !branch.branchName) return body;
  const lines = [body, `\n**Branch**: \`${branch.branchName}\``];
  if (branch.branchUrl) lines.push(`\n[View branch](${branch.branchUrl})`);
  if (branch.createPrUrl)
    lines.push(`\n[Create pull request](${branch.createPrUrl})`);
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  let config: ActionConfig | undefined;
  let context: NeoContext | undefined;
  let octokit: GitHubClient | undefined;
  let trackingComment: TrackingComment = null;
  const inlineBuffer: InlineComment[] = [];

  try {
    config = readConfig();
    await resolveGitHubToken(config);
    context = parseContext(config);
    octokit = github.getOctokit(config.githubToken);

    core.info(`Garda Code Action on ${context.repository.fullName}`);
    core.info(
      `Event: ${context.eventName}${context.eventAction ? `.${context.eventAction}` : ""}`,
    );
    core.info(`Mode input: ${config.mode}`);

    if (context.isPR) await hydratePullRequestContext(octokit, context);
    assertFixAllowed(context);
    const executionMode = detectExecutionMode(context);
    core.info(`Execution mode: ${executionMode}`);

    if (executionMode === "skip") {
      core.setOutput("conclusion", "skipped");
      core.notice(
        `No ${config.triggerPhrase} trigger or automation prompt found. Skipping.`,
      );
      return;
    }

    if (context.isEntity) {
      const triggered = config.prompt.trim()
        ? true
        : containsTrigger(context) || executionMode === "agent";
      if (!triggered) {
        core.setOutput("conclusion", "skipped");
        core.notice(`No trigger found. Skipping.`);
        return;
      }
      await validateActorAndPermissions(octokit, context);
      const preFetchStatus = context.isPR
        ? "- [x] Trigger validated\n- [ ] Restoring trusted config\n- [ ] Fetching GitHub context"
        : "- [x] Trigger validated\n- [ ] Fetching GitHub context";
      trackingComment = await createOrUpdateTrackingComment(
        octokit,
        context,
        trackingComment,
        preFetchStatus,
      );
    }

    if (context.isPR) {
      await preparePullRequestWorkspace(context);
      await restoreTrustedConfigFromBase(context);
      trackingComment = await createOrUpdateTrackingComment(
        octokit,
        context,
        trackingComment,
        "- [x] Trigger validated\n- [x] Trusted config restored\n- [ ] Fetching GitHub context",
      );
    }

    const data = await fetchGitHubData(octokit, context);

    if (
      !context.isPR &&
      context.isEntity &&
      context.config.mode === "fix" &&
      context.config.allowFix
    ) {
      const issueWorkspace = await prepareIssueWorkspace(context, data);
      if (issueWorkspace.prepared) {
        trackingComment = await createOrUpdateTrackingComment(
          octokit,
          context,
          trackingComment,
          `- [x] Trigger validated\n- [x] GitHub context fetched\n- [x] Created work branch \`${issueWorkspace.branch}\`\n- [ ] Running Garda Code agent`,
        );
      }
    }

    const agentStatus = context.isPR
      ? "- [x] Trigger validated\n- [x] Trusted config restored\n- [x] GitHub context fetched\n- [ ] Running Garda Code agent"
      : "- [x] Trigger validated\n- [x] GitHub context fetched\n- [ ] Running Garda Code agent";
    trackingComment = await createOrUpdateTrackingComment(
      octokit,
      context,
      trackingComment,
      agentStatus,
    );

    const formattedContext = formatGitHubContext(context, data);
    const request = extractUserRequest(context);
    const systemPrompt = buildSystemPrompt(context);
    const taskPrompt = buildTaskPrompt(
      context,
      data,
      request,
      formattedContext,
    );
    const client = createNeosantaraClient(config);

    const result = await runNeoAgent({
      client,
      github: context,
      data,
      systemPrompt,
      taskPrompt,
      octokit,
      trackingComment,
      setTrackingComment(comment) {
        trackingComment = comment;
      },
      inlineBuffer,
    });

    const inlineClassification = await classifyBufferedInlineComments({
      client,
      context,
      data,
      comments: inlineBuffer,
    });
    const posted = await postBufferedInlineComments(
      octokit,
      context,
      inlineClassification.comments,
    );
    const branchFinalization = await finalizeCreatedBranch(octokit, context);
    const executionFile = await writeExecutionTranscript(
      context,
      result,
      posted,
      branchFinalization,
      data.commentImages.map((image) => ({
        sourceType: image.sourceType,
        sourceId: image.sourceId,
        originalUrl: image.originalUrl,
        localPath: image.localPath,
        mimeType: image.mimeType,
        bytes: image.bytes,
      })),
    );
    const reviewLine = posted.reviewUrl
      ? `
- Review: ${posted.reviewUrl}`
      : "";
    const classifierLine = inlineClassification.usedModel
      ? `\n- Inline classifier: model (${config.inlineClassifierModel}), ${inlineClassification.skipped} rejected`
      : inlineClassification.decisions.length
        ? `\n- Inline classifier: heuristic, ${inlineClassification.skipped} rejected`
        : "";
    const finalBody = `### Garda Code Action result

${result.text}

---

**Details**

- Model: \`${config.model}\`
- Responses API response id: \`${result.responseId || "n/a"}\`
- Tool loop steps: ${result.steps}
- Inline comments: ${posted.posted} posted, ${posted.skipped} skipped${reviewLine}${classifierLine}
- Execution transcript: \`${executionFile}\`
`;
    await updateTrackingComment(
      octokit,
      context,
      trackingComment,
      addBranchLinks(context, finalBody, branchFinalization),
    );

    core.setOutput("conclusion", "success");
    core.setOutput("summary", result.text.slice(0, 4000));
    core.setOutput(
      "findings_count",
      String(
        inlineClassification.comments.filter(
          (comment) => comment.confirmed !== false,
        ).length,
      ),
    );
    core.setOutput("comment_url", trackingComment?.html_url || "");
    core.setOutput("response_id", result.responseId || "");
    core.setOutput("usage_json", JSON.stringify(result.usage || {}));
    core.setOutput("execution_file", executionFile);
    core.setOutput("branch_name", context.workingBranch || "");
    core.setOutput("session_id", result.responseId || "");
    core.setOutput("github_token", config.githubToken);
    if (config.displayReport)
      await core.summary
        .addHeading("Garda Code Action")
        .addRaw(result.text)
        .write();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setOutput("conclusion", "failed");
    if (
      octokit !== undefined &&
      context &&
      trackingComment &&
      context.isEntity
    ) {
      try {
        await updateTrackingComment(
          octokit,
          context,
          trackingComment,
          `### Garda Code Action failed\n\n\`\`\`text\n${message.slice(0, 4000)}\n\`\`\``,
        );
      } catch (updateError) {
        core.warning(
          `Failed to update tracking comment after error: ${updateError instanceof Error ? updateError.message : String(updateError)}`,
        );
      }
    }
    core.setFailed(message);
  }
}

main();
