import * as core from "@actions/core";
import { execa } from "execa";
import { existsSync } from "node:fs";
import type { NeoContext } from "./context.js";
import type { GitHubClient } from "./types.js";
import type { GitHubData } from "./data.js";
import { isRepositoryMutationAllowed } from "./permissions.js";
import { validateBranchName } from "./trusted-config.js";
import { generateBranchName } from "../utils/branch-template.js";

export async function hydratePullRequestContext(
  octokit: GitHubClient,
  context: NeoContext,
): Promise<void> {
  if (!context.isPR || !context.entityNumber) return;
  if (
    context.baseBranch &&
    context.headBranch &&
    context.headSha &&
    context.baseRepoFullName &&
    context.headRepoFullName
  )
    return;

  const { data: pr } = await octokit.rest.pulls.get({
    owner: context.repository.owner,
    repo: context.repository.repo,
    pull_number: context.entityNumber,
  });

  context.payload.pull_request = context.payload.pull_request || pr;
  context.baseBranch = pr.base?.ref || context.baseBranch;
  context.headBranch = pr.head?.ref || context.headBranch;
  context.headSha = pr.head?.sha || context.headSha;
  context.baseSha = pr.base?.sha || context.baseSha;
  context.baseRepoFullName =
    pr.base?.repo?.full_name ||
    context.baseRepoFullName ||
    context.repository.fullName;
  context.headRepoFullName =
    pr.head?.repo?.full_name ||
    context.headRepoFullName ||
    context.repository.fullName;
  context.isForkPR = Boolean(
    context.baseRepoFullName &&
    context.headRepoFullName &&
    context.baseRepoFullName !== context.headRepoFullName,
  );
}

async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await execa("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
    return true;
  } catch {
    return false;
  }
}

async function ensureGitWorkspace(): Promise<string | null> {
  const cwd = process.env.GITHUB_WORKSPACE || process.cwd();
  if (existsSync(`${cwd}/.git`) || (await isGitRepo(cwd))) return cwd;
  core.warning(
    "Workspace is not a git checkout. File tools may only use GitHub API context. Add actions/checkout before this action.",
  );
  return null;
}

function safeLocalBranchName(context: NeoContext): string {
  return `garda/pr-${context.entityNumber}`;
}

/**
 * Claude Code Action prepares the checkout before tools run so file tools read
 * the PR contents, not whatever branch actions/checkout happened to leave in
 * the workspace. This mirrors that behavior in a smaller form:
 * - review/ask/security: checkout refs/pull/<n>/head in detached mode
 * - fix mode on same-repo PRs: checkout a local branch from the PR head and
 *   push commits back to the PR head branch
 * Sensitive config is restored from the base branch immediately after this step.
 */
export async function preparePullRequestWorkspace(
  context: NeoContext,
): Promise<{ prepared: boolean; mode: string }> {
  if (!context.isPR || !context.entityNumber)
    return { prepared: false, mode: "not-pr" };

  const cwd = await ensureGitWorkspace();
  if (!cwd) return { prepared: false, mode: "no-git" };

  const mutating = isRepositoryMutationAllowed(context);
  if (mutating) {
    if (!context.headBranch)
      throw new Error(
        "Cannot prepare fix workspace: PR head branch is unknown",
      );
    validateBranchName(context.headBranch);
    const localBranch = safeLocalBranchName(context);
    core.info(
      `Preparing writable PR workspace from origin/${context.headBranch} -> ${localBranch}`,
    );
    await execa(
      "git",
      [
        "fetch",
        "origin",
        context.headBranch,
        "--depth=1",
        "--no-recurse-submodules",
      ],
      { cwd, stdio: "inherit", env: process.env },
    );
    await execa("git", ["checkout", "-B", localBranch, "FETCH_HEAD"], {
      cwd,
      stdio: "inherit",
      env: process.env,
    });
    context.workingBranch = context.headBranch;
    return { prepared: true, mode: "same-repo-fix-branch" };
  }

  core.info(
    `Preparing read-only PR workspace from refs/pull/${context.entityNumber}/head`,
  );
  await execa(
    "git",
    [
      "fetch",
      "origin",
      `refs/pull/${context.entityNumber}/head`,
      "--depth=1",
      "--no-recurse-submodules",
    ],
    { cwd, stdio: "inherit", env: process.env },
  );
  await execa("git", ["checkout", "--detach", "FETCH_HEAD"], {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  return { prepared: true, mode: "detached-pr-head" };
}

function firstLabel(data: GitHubData): string | undefined {
  const labels = data.entity?.labels;
  if (Array.isArray(labels) && labels.length > 0)
    return typeof labels[0] === "string" ? labels[0] : labels[0]?.name;
  return undefined;
}

export async function prepareIssueWorkspace(
  context: NeoContext,
  data: GitHubData,
): Promise<{ prepared: boolean; branch?: string; mode: string }> {
  if (!context.isEntity || context.isPR || !context.entityNumber)
    return { prepared: false, mode: "not-issue" };
  if (!isRepositoryMutationAllowed(context))
    return { prepared: false, mode: "read-only-issue" };

  const cwd = await ensureGitWorkspace();
  if (!cwd) return { prepared: false, mode: "no-git" };

  const baseBranch =
    context.baseBranch ||
    context.repository.defaultBranch ||
    data.entity?.repository?.default_branch ||
    "main";
  validateBranchName(baseBranch);
  context.baseBranch = baseBranch;

  const branch = generateBranchName({
    template: context.config.branchNameTemplate,
    branchPrefix: context.config.branchPrefix,
    entityType: "issue",
    entityNumber: context.entityNumber,
    sha: context.headSha,
    label: firstLabel(data),
    title: data.entity?.title || context.payload.issue?.title || "",
  });
  validateBranchName(branch);

  core.info(
    `Preparing writable issue workspace from origin/${baseBranch} -> ${branch}`,
  );
  await execa(
    "git",
    ["fetch", "origin", baseBranch, "--depth=1", "--no-recurse-submodules"],
    { cwd, stdio: "inherit", env: process.env },
  );
  await execa("git", ["checkout", "-B", branch, "FETCH_HEAD"], {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  context.workingBranch = branch;
  context.createdBranch = true;
  return { prepared: true, branch, mode: "issue-fix-branch" };
}
