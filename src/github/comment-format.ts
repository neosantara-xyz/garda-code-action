import type { NeoContext } from "./context.js";
import type { BranchFinalization } from "./branch-cleanup.js";

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/**
 * Build a single-line action bar with bullet-separated links, mirroring Claude
 * Code Action's compact, scannable layout:
 *   —— [View workflow run](url) • [`branch`](url) • [Create PR ➔](url)
 */
export function buildActionBar(
  context: NeoContext,
  branch: BranchFinalization,
): string {
  const links: string[] = [`[View workflow run](${context.runUrl})`];
  if (branch.branchName && branch.hasChanges && !branch.deleted) {
    if (branch.branchUrl)
      links.push(`[\`${branch.branchName}\`](${branch.branchUrl})`);
    else links.push(`\`${branch.branchName}\``);
    if (branch.createPrUrl) links.push(`[Create PR ➔](${branch.createPrUrl})`);
  }
  return ` —— ${links.join(" • ")}`;
}

/**
 * Compose the final completion comment with a glanceable header
 * (`**Garda finished @user's task in Xm Ys**`), an inline action bar, then the
 * model output and details.
 */
export function composeFinalComment(params: {
  context: NeoContext;
  actor: string;
  durationMs: number;
  branch: BranchFinalization;
  resultText: string;
  details: string;
  failed?: boolean;
  errorDetails?: string;
}): string {
  const { context, actor, durationMs, branch, resultText, details, failed } =
    params;
  const duration = formatDuration(durationMs);
  const header = failed
    ? `**Garda encountered an error after ${duration}**`
    : `**Garda finished @${actor}'s task in ${duration}**`;
  const actionBar = buildActionBar(context, branch);

  let body = `${header}${actionBar}\n\n---\n`;
  if (failed && params.errorDetails) {
    body += `\n\`\`\`text\n${params.errorDetails}\n\`\`\`\n`;
  }
  if (resultText) body += `\n${resultText}\n`;
  if (branch.deleted && branch.branchName) {
    body += `\n> Branch \`${branch.branchName}\` was deleted because no changes were committed.\n`;
  }
  if (details) body += `\n${details}`;
  return body;
}
