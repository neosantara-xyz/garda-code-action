import * as core from "@actions/core";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { dirname } from "node:path";
import { execa } from "execa";
import type { NeoContext } from "./context.js";

// Same security idea as Claude Code Action's restore-config: paths that may be read
// by tools, agents, git, or MCP/runtime setup must come from the trusted base branch.
export const SENSITIVE_CONFIG_PATHS = [
  ".garda",
  ".neo",
  ".neosantara",
  "garda-action.json",
  "neo-action.json",
  "GARDA.md",
  "NEO.md",
  "AGENTS.md",
  ".mcp.json",
  ".gitmodules",
  ".ripgreprc",
  ".husky",
];

const PR_SNAPSHOT_DIR = ".garda-pr";
const PR_EXCLUDE_PATTERN = `/${PR_SNAPSHOT_DIR}/`;

export function validateBranchName(branch: string): void {
  if (!branch || branch.trim().length === 0 || branch.length > 255)
    throw new Error("Invalid empty/long base branch name");
  if (
    branch.startsWith("-") ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.startsWith(".")
  )
    throw new Error(`Invalid base branch name: ${branch}`);
  if (branch.endsWith(".") || branch.endsWith(".lock"))
    throw new Error(`Invalid base branch name: ${branch}`);
  if (branch.includes("..") || branch.includes("//") || branch.includes("@{"))
    throw new Error(`Invalid base branch name: ${branch}`);
  if (/[\x00-\x20\x7F~^:?*\\[\]]/.test(branch))
    throw new Error(`Invalid base branch name: ${branch}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9/_.#+,-]*$/.test(branch))
    throw new Error(`Invalid base branch name: ${branch}`);
}

async function ensureSnapshotExcludedFromGit(cwd: string): Promise<void> {
  const { stdout } = await execa(
    "git",
    ["rev-parse", "--git-path", "info/exclude"],
    { cwd },
  );
  const excludePath = stdout.trim();
  const excludeContents = existsSync(excludePath)
    ? readFileSync(excludePath, "utf8")
    : "";
  if (excludeContents.split(/\r?\n/).includes(PR_EXCLUDE_PATTERN)) return;
  mkdirSync(dirname(excludePath), { recursive: true });
  const prefix =
    excludeContents.length === 0 || excludeContents.endsWith("\n") ? "" : "\n";
  appendFileSync(excludePath, `${prefix}${PR_EXCLUDE_PATTERN}\n`);
}

export async function restoreTrustedConfigFromBase(
  context: NeoContext,
): Promise<{ restored: string[]; snapshotted: string[] } | null> {
  if (
    !context.config.restoreTrustedConfig ||
    !context.isPR ||
    !context.baseBranch
  )
    return null;

  const cwd = process.env.GITHUB_WORKSPACE || process.cwd();
  validateBranchName(context.baseBranch);

  core.info(
    `Restoring trusted config from origin/${context.baseBranch}: ${SENSITIVE_CONFIG_PATHS.join(", ")}`,
  );

  const snapshotted: string[] = [];
  rmSync(`${cwd}/${PR_SNAPSHOT_DIR}`, { recursive: true, force: true });
  for (const path of SENSITIVE_CONFIG_PATHS) {
    const full = `${cwd}/${path}`;
    if (existsSync(full)) {
      cpSync(full, `${cwd}/${PR_SNAPSHOT_DIR}/${path}`, {
        recursive: true,
        dereference: true,
      });
      snapshotted.push(path);
    }
  }
  if (snapshotted.length > 0) {
    await ensureSnapshotExcludedFromGit(cwd);
    core.info(
      `Preserved PR-authored sensitive config in ${PR_SNAPSHOT_DIR}/ for review only: ${snapshotted.join(", ")}`,
    );
  }

  // Delete PR-controlled versions before fetching. If a path does not exist on base,
  // the safe fallback is that it stays deleted rather than using attacker-controlled content.
  for (const path of SENSITIVE_CONFIG_PATHS) {
    rmSync(`${cwd}/${path}`, { recursive: true, force: true });
  }

  await execa(
    "git",
    [
      "fetch",
      "origin",
      context.baseBranch,
      "--depth=1",
      "--no-recurse-submodules",
    ],
    { cwd, stdio: "inherit", env: process.env },
  );

  const restored: string[] = [];
  for (const path of SENSITIVE_CONFIG_PATHS) {
    try {
      await execa(
        "git",
        ["checkout", `origin/${context.baseBranch}`, "--", path],
        { cwd },
      );
      restored.push(path);
    } catch {
      // Missing on base; leave deleted.
    }
  }

  try {
    await execa("git", ["reset", "--", ...SENSITIVE_CONFIG_PATHS], { cwd });
  } catch {
    // Nothing staged, or path absent. Safe to continue.
  }

  core.info(
    `Trusted config restore complete. Restored: ${restored.length ? restored.join(", ") : "none"}`,
  );
  return { restored, snapshotted };
}
