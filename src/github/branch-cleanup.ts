import * as core from "@actions/core";
import type { NeoContext } from "./context.js";
import type { GitHubClient } from "./types.js";

export type BranchFinalization = {
  branchName?: string;
  hasChanges: boolean;
  deleted: boolean;
  branchUrl?: string;
  createPrUrl?: string;
};

export async function finalizeCreatedBranch(
  octokit: GitHubClient,
  context: NeoContext,
): Promise<BranchFinalization> {
  if (!context.createdBranch || !context.workingBranch) {
    return { hasChanges: false, deleted: false };
  }

  const branchName = context.workingBranch;
  const baseBranch =
    context.baseBranch || context.repository.defaultBranch || "main";
  const owner = context.repository.owner;
  const repo = context.repository.repo;
  const branchUrl = `https://github.com/${context.repository.fullName}/tree/${encodeURIComponent(branchName)}`;

  let hasChanges = true;
  try {
    const { data } = await octokit.rest.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `${baseBranch}...${branchName}`,
    });
    hasChanges = Boolean(
      (data.total_commits || 0) > 0 ||
      (Array.isArray(data.files) && data.files.length > 0),
    );
  } catch (error) {
    core.warning(
      `Could not compare created branch ${branchName}: ${error instanceof Error ? error.message : String(error)}`,
    );
    hasChanges = true;
  }

  if (!hasChanges && context.config.cleanupEmptyBranch) {
    try {
      await octokit.rest.git.deleteRef({
        owner,
        repo,
        ref: `heads/${branchName}`,
      });
      context.createdBranch = false;
      core.info(`Deleted empty Garda Code branch: ${branchName}`);
      return { branchName, hasChanges: false, deleted: true };
    } catch (error) {
      core.warning(
        `Could not delete empty Garda Code branch ${branchName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (!hasChanges)
    return { branchName, hasChanges: false, deleted: false, branchUrl };

  const title = encodeURIComponent(
    `Issue #${context.entityNumber}: Changes from Garda Code`,
  );
  const body = encodeURIComponent(
    `This PR addresses issue #${context.entityNumber}.\n\nGenerated with Garda Code Action.`,
  );
  const createPrUrl = `https://github.com/${context.repository.fullName}/compare/${encodeURIComponent(
    baseBranch,
  )}...${encodeURIComponent(branchName)}?quick_pull=1&title=${title}&body=${body}`;

  return {
    branchName,
    hasChanges: true,
    deleted: false,
    branchUrl,
    createPrUrl,
  };
}
