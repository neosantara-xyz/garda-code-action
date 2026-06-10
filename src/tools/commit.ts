import { z } from "zod";
import { execa } from "execa";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { GitHubClient } from "../github/types.js";
import type { NeoTool, ToolExecutionContext } from "./types.js";
import { splitList } from "../utils/text.js";
import { shouldIgnore } from "../github/data.js";
import { isRepositoryMutationAllowed } from "../github/permissions.js";
import { validateBranchName } from "../github/trusted-config.js";
import { subprocessEnv } from "../utils/subprocess-env.js";

const SSH_SIGNING_KEY_PATH = join(homedir(), ".ssh", "garda_signing_key");

export async function setupSshSigning(
  sshSigningKey: string,
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<void> {
  if (!sshSigningKey.trim()) {
    throw new Error("SSH signing key cannot be empty");
  }
  if (
    !sshSigningKey.includes("BEGIN") ||
    !sshSigningKey.includes("PRIVATE KEY")
  ) {
    throw new Error("Invalid SSH private key format");
  }

  const sshDir = join(homedir(), ".ssh");
  await mkdir(sshDir, { recursive: true, mode: 0o700 });

  const normalizedKey = sshSigningKey.endsWith("\n")
    ? sshSigningKey
    : sshSigningKey + "\n";

  await writeFile(SSH_SIGNING_KEY_PATH, normalizedKey, { mode: 0o600 });

  await execa("git", ["config", "gpg.format", "ssh"], { cwd, env });
  await execa("git", ["config", "user.signingkey", SSH_SIGNING_KEY_PATH], {
    cwd,
    env,
  });
  await execa("git", ["config", "commit.gpgsign", "true"], { cwd, env });
}

export async function cleanupSshSigning(): Promise<void> {
  const { rm } = await import("node:fs/promises");
  try {
    await rm(SSH_SIGNING_KEY_PATH, { force: true });
  } catch {
    // Ignore error
  }
  // Also remove the git credential helper script if it was written.
  try {
    const helperPath = join(
      process.env.RUNNER_TEMP || process.cwd(),
      "garda-git-credential-helper.sh",
    );
    await rm(helperPath, { force: true });
  } catch {
    // Ignore error
  }
}

function validateRepoRelativePath(path: string): void {
  if (!path || path.startsWith("/") || path.includes("\\"))
    throw new Error(`Invalid repository path: ${path}`);
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".."))
    throw new Error(`Invalid repository path: ${path}`);
}

/**
 * Defense-in-depth before pushing: the target branch must pass the strict
 * branch-name whitelist AND git's own check-ref-format. This rejects option
 * injection (leading `-`), arbitrary remotes/refspecs, and malformed refs even
 * though we already use array args (no shell). Mirrors Claude's git-push.sh.
 */
async function assertSafePushTarget(
  branch: string,
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<void> {
  if (branch.startsWith("-"))
    throw new Error(`Refusing to push to option-like ref: ${branch}`);
  validateBranchName(branch);
  const result = await execa("git", ["check-ref-format", "--branch", branch], {
    cwd,
    env,
    reject: false,
  });
  if (result.exitCode !== 0)
    throw new Error(`git rejected branch ref format: ${branch}`);
}

function committer(ctx: ToolExecutionContext) {
  const botName = ctx.github.config.botName || "garda-code[bot]";
  const botId = ctx.github.config.botId;
  const email = botId
    ? `${botId}+${botName}@users.noreply.github.com`
    : `${botName}@users.noreply.github.com`;
  return { name: botName, email };
}

async function configureGitAuth(
  ctx: ToolExecutionContext,
  cwd: string,
): Promise<void> {
  const identity = committer(ctx);
  const env = subprocessEnv(ctx, { githubToken: true });
  await execa("git", ["config", "user.name", identity.name], { cwd, env });
  await execa("git", ["config", "user.email", identity.email], { cwd, env });

  if (ctx.github.config.sshSigningKey) {
    await setupSshSigning(ctx.github.config.sshSigningKey, cwd, env);
  }

  // actions/checkout may leave an auth extraheader. Use a credential helper so
  // the token stays out of .git/config and command arguments, matching Claude's
  // safer pattern for untrusted-trigger scenarios.
  try {
    await execa(
      "git",
      ["config", "--unset-all", "http.https://github.com/.extraheader"],
      { cwd, env },
    );
  } catch {
    // No checkout header; fine.
  }

  const helperPath = join(
    process.env.RUNNER_TEMP || cwd,
    "garda-git-credential-helper.sh",
  );
  await mkdir(dirname(helperPath), { recursive: true });
  await writeFile(
    helperPath,
    '#!/bin/sh\necho username=x-access-token\necho password="$GH_TOKEN"\n',
    { mode: 0o700 },
  );
  await execa("git", ["config", "credential.helper", helperPath], { cwd, env });
  await execa(
    "git",
    [
      "remote",
      "set-url",
      "origin",
      `https://github.com/${ctx.github.repository.fullName}.git`,
    ],
    { cwd, env },
  );
}

async function commitWithGit(
  args: { files: string[]; message: string },
  ctx: ToolExecutionContext,
) {
  const cwd = process.env.GITHUB_WORKSPACE || process.cwd();
  await configureGitAuth(ctx, cwd);
  const env = subprocessEnv(ctx, { githubToken: true });
  for (const file of args.files)
    await execa("git", ["add", "--", file], { cwd, env });
  const status = await execa("git", ["diff", "--cached", "--name-only"], {
    cwd,
    env,
  });
  const changed = splitList(status.stdout);
  if (changed.length === 0)
    return { committed: false, reason: "no staged changes" };
  await execa("git", ["commit", "-m", args.message], {
    cwd,
    stdio: "inherit",
    env,
  });
  const targetBranch = ctx.github.isPR
    ? ctx.github.headBranch
    : ctx.github.workingBranch;
  if (!targetBranch)
    throw new Error("Cannot push commit: target branch is unknown");
  await assertSafePushTarget(targetBranch, cwd, env);
  const pushRef = `HEAD:${targetBranch}`;
  await execa("git", ["push", "origin", "--", pushRef], {
    cwd,
    stdio: "inherit",
    env,
  });
  return {
    committed: true,
    files: changed,
    message: args.message,
    branch: targetBranch,
    strategy: "git",
  };
}

async function getRefSha(
  octokit: GitHubClient,
  ctx: ToolExecutionContext,
  branch: string,
): Promise<string | null> {
  try {
    const { data } = await octokit.rest.git.getRef({
      owner: ctx.github.repository.owner,
      repo: ctx.github.repository.repo,
      ref: `heads/${branch}`,
    });
    return data.object.sha;
  } catch {
    return null;
  }
}

async function createBranchRefIfMissing(
  octokit: GitHubClient,
  ctx: ToolExecutionContext,
  branch: string,
): Promise<string> {
  const existing = await getRefSha(octokit, ctx, branch);
  if (existing) return existing;
  const baseBranch =
    ctx.github.baseBranch || ctx.github.repository.defaultBranch || "main";
  const baseSha = await getRefSha(octokit, ctx, baseBranch);
  if (!baseSha)
    throw new Error(
      `Cannot create branch ${branch}: base branch ${baseBranch} not found`,
    );
  await octokit.rest.git.createRef({
    owner: ctx.github.repository.owner,
    repo: ctx.github.repository.repo,
    ref: `refs/heads/${branch}`,
    sha: baseSha,
  });
  return baseSha;
}

async function commitWithGitHubApi(
  args: { files: string[]; message: string },
  ctx: ToolExecutionContext,
) {
  const cwd = process.env.GITHUB_WORKSPACE || process.cwd();
  const env = subprocessEnv(ctx, { githubToken: false });
  const status = await execa(
    "git",
    ["status", "--porcelain", "--", ...args.files],
    { cwd, env },
  );
  const changed = splitList(status.stdout);
  if (changed.length === 0)
    return {
      committed: false,
      reason: "no local changes",
      strategy: "github-api",
    };
  const targetBranch = ctx.github.isPR
    ? ctx.github.headBranch
    : ctx.github.workingBranch;
  if (!targetBranch)
    throw new Error("Cannot create API commit: target branch is unknown");
  if (targetBranch.startsWith("-")) {
    throw new Error(`Refusing to target option-like ref: ${targetBranch}`);
  }
  validateBranchName(targetBranch);

  const owner = ctx.github.repository.owner;
  const repo = ctx.github.repository.repo;
  const headSha = await createBranchRefIfMissing(
    ctx.octokit,
    ctx,
    targetBranch,
  );
  const { data: headCommit } = await ctx.octokit.rest.git.getCommit({
    owner,
    repo,
    commit_sha: headSha,
  });

  const tree: Array<{
    path: string;
    mode: "100644" | "100755";
    type: "blob";
    sha: string;
  }> = [];
  for (const file of args.files) {
    const fullPath = join(cwd, file);
    const content = await readFile(fullPath);
    // Preserve the executable bit so committed scripts stay runnable
    // (matches Claude Code Action's 100644 vs 100755 handling).
    let mode: "100644" | "100755" = "100644";
    try {
      const fileStat = await stat(fullPath);
      if (fileStat.mode & fsConstants.S_IXUSR) mode = "100755";
    } catch {
      // Default to non-executable on stat failure
    }
    const { data: blob } = await ctx.octokit.rest.git.createBlob({
      owner,
      repo,
      content: content.toString("base64"),
      encoding: "base64",
    });
    tree.push({ path: file, mode, type: "blob", sha: blob.sha });
  }

  const { data: newTree } = await ctx.octokit.rest.git.createTree({
    owner,
    repo,
    base_tree: headCommit.tree.sha,
    tree,
  });
  const identity = committer(ctx);
  const { data: newCommit } = await ctx.octokit.rest.git.createCommit({
    owner,
    repo,
    message: args.message,
    tree: newTree.sha,
    parents: [headSha],
    author: identity,
    committer: identity,
  });
  if (newCommit.sha === headSha)
    return { committed: false, reason: "no changes", strategy: "github-api" };
  // Retry updateRef on transient 403/409 (concurrent ref update) with backoff,
  // matching Claude Code Action's resilient ref update.
  let updated = false;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await ctx.octokit.rest.git.updateRef({
        owner,
        repo,
        ref: `heads/${targetBranch}`,
        sha: newCommit.sha,
        force: false,
      });
      updated = true;
      break;
    } catch (error) {
      const status = (error as { status?: number })?.status;
      if (attempt >= 3 || (status !== 403 && status !== 409)) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(1000 * 2 ** (attempt - 1), 4000)),
      );
    }
  }
  if (!updated)
    throw new Error(`Failed to update ref heads/${targetBranch} after retries`);
  try {
    await configureGitAuth(ctx, cwd);
    const syncEnv = subprocessEnv(ctx, { githubToken: true });
    await execa("git", ["fetch", "origin", targetBranch, "--depth=1"], {
      cwd,
      env: syncEnv,
    });
    await execa("git", ["reset", "--hard", "FETCH_HEAD"], {
      cwd,
      env: syncEnv,
    });
  } catch {
    // Best-effort local sync only. The remote ref is already updated.
  }
  return {
    committed: true,
    files: args.files,
    local_changes: changed,
    message: args.message,
    branch: targetBranch,
    sha: newCommit.sha,
    strategy: "github-api",
    verified_by_github_api: true,
  };
}

export const commitTools: NeoTool[] = [
  {
    name: "git_commit_files",
    description:
      "Commit selected changed files to the current PR/issue branch. Disabled unless allow_fix=true. Supports git push or GitHub API commit strategy.",
    schema: z.object({
      files: z.array(z.string()),
      message: z.string().optional(),
      strategy: z.enum(["git", "github-api"]).optional(),
    }),
    readonly: false,
    async execute(args, ctx) {
      if (!isRepositoryMutationAllowed(ctx.github))
        throw new Error(
          "git_commit_files is disabled. Requires allow_fix=true, mode=fix, and a non-fork pull request.",
        );
      const parsed = this.schema.parse(args) as {
        files: string[];
        message?: string;
        strategy?: "git" | "github-api";
      };
      for (const file of parsed.files) {
        validateRepoRelativePath(file);
        if (shouldIgnore(file, ctx.github.config.ignore))
          throw new Error(`Path is ignored by action config: ${file}`);
      }
      const baseMessage = parsed.message || ctx.github.config.commitMessage;
      // Co-authorship trailer (matches Claude Code Action format).
      // Fall back to the actor login when the display name is unavailable,
      // and skip only when there is no usable actor at all.
      const coAuthorName = ctx.data.triggerDisplayName || ctx.github.actor;
      const coAuthor =
        coAuthorName && ctx.github.actor
          ? `\n\nCo-authored-by: ${coAuthorName} <${ctx.github.actor}@users.noreply.github.com>`
          : "";
      const message = baseMessage.includes("Co-authored-by:")
        ? baseMessage
        : `${baseMessage}${coAuthor}`;
      const strategy = parsed.strategy || ctx.github.config.commitStrategy;
      if (ctx.github.config.dryRun)
        return { dry_run: true, files: parsed.files, strategy };
      if (strategy === "github-api") {
        return await commitWithGitHubApi({ files: parsed.files, message }, ctx);
      }
      return await commitWithGit({ files: parsed.files, message }, ctx);
    },
  },
];
