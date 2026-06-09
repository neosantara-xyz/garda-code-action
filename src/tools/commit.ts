import { z } from "zod";
import { execa } from "execa";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { GitHubClient } from "../github/types.js";
import type { NeoTool, ToolExecutionContext } from "./types.js";
import { splitList } from "../utils/text.js";
import { shouldIgnore } from "../github/data.js";
import { subprocessEnv } from "../utils/subprocess-env.js";

function validateRepoRelativePath(path: string): void {
  if (!path || path.startsWith("/") || path.includes("\\"))
    throw new Error(`Invalid repository path: ${path}`);
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".."))
    throw new Error(`Invalid repository path: ${path}`);
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
  const pushRef = `HEAD:${targetBranch}`;
  await execa("git", ["push", "origin", pushRef], {
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
    mode: "100644";
    type: "blob";
    sha: string;
  }> = [];
  for (const file of args.files) {
    const content = await readFile(join(cwd, file));
    const { data: blob } = await ctx.octokit.rest.git.createBlob({
      owner,
      repo,
      content: content.toString("base64"),
      encoding: "base64",
    });
    tree.push({ path: file, mode: "100644", type: "blob", sha: blob.sha });
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
  await ctx.octokit.rest.git.updateRef({
    owner,
    repo,
    ref: `heads/${targetBranch}`,
    sha: newCommit.sha,
    force: false,
  });
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
      if (!ctx.github.config.allowFix)
        throw new Error(
          "git_commit_files is disabled. Set allow_fix=true and mode=fix to enable commits.",
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
      const message = parsed.message || ctx.github.config.commitMessage;
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
