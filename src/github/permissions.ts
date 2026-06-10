import * as core from "@actions/core";
import { splitList } from "../utils/text.js";
import type { NeoContext } from "./context.js";
import type { GitHubClient } from "./types.js";

function normalizeBot(actor: string): string {
  return actor.toLowerCase().replace(/\[bot\]$/, "");
}

function isAllowed(actor: string, allowList: string): boolean {
  const trimmed = allowList.trim();
  if (!trimmed) return false;
  if (trimmed === "*") return true;
  const normalized = normalizeBot(actor);
  return splitList(trimmed).some(
    (item) => normalizeBot(item) === normalized || item === actor,
  );
}

export function isRepositoryMutationAllowed(context: NeoContext): boolean {
  return Boolean(
    context.isEntity &&
    context.config.allowFix &&
    context.config.mode === "fix" &&
    !context.isForkPR &&
    !context.isClosedOrMergedPR,
  );
}

export async function validateActorAndPermissions(
  octokit: GitHubClient,
  context: NeoContext,
): Promise<{ canWrite: boolean; isBot: boolean }> {
  const actor = context.actor;
  let isBot = actor.endsWith("[bot]");

  try {
    const { data } = await octokit.rest.users.getByUsername({
      username: actor,
    });
    isBot = data.type !== "User";
  } catch {
    // Matches Claude Code Action's stance: non-user actors are likely Apps/bots and must be explicitly allowed.
    isBot = true;
  }

  if (isBot && !isAllowed(actor, context.config.allowedBots)) {
    throw new Error(
      `Workflow initiated by non-human actor '${actor}'. Add it to allowed_bots or use '*' explicitly.`,
    );
  }

  if (!context.isEntity) return { canWrite: true, isBot };

  if (context.config.allowedNonWriteUsers) {
    const wildcard = context.config.allowedNonWriteUsers.trim() === "*";
    if (
      wildcard ||
      splitList(context.config.allowedNonWriteUsers).includes(actor)
    ) {
      if (wildcard) {
        core.warning(
          `⚠️ SECURITY WARNING: Bypassing write permission check for ${actor} due to allowed_non_write_users='*'. This grants ANY user the ability to trigger the action — use only with very limited workflow permissions.`,
        );
      } else {
        core.warning(
          `⚠️ Bypassing write permission check for ${actor} via allowed_non_write_users. Use only with limited workflow permissions.`,
        );
      }
      return { canWrite: true, isBot };
    }
  }

  if (isBot && isAllowed(actor, context.config.allowedBots))
    return { canWrite: true, isBot };

  const { data } = await octokit.rest.repos.getCollaboratorPermissionLevel({
    owner: context.repository.owner,
    repo: context.repository.repo,
    username: actor,
  });
  const canWrite = ["admin", "maintain", "write"].includes(data.permission);
  if (!canWrite) {
    throw new Error(
      `Actor '${actor}' has '${data.permission}' permission. Write permission is required unless allowed_non_write_users is configured.`,
    );
  }
  return { canWrite, isBot };
}

export function assertFixAllowed(context: NeoContext): void {
  if (context.config.mode === "fix" && !context.config.allowFix) {
    throw new Error(
      "mode=fix requires allow_fix=true. This prevents accidental writes from untrusted prompts.",
    );
  }
  if (context.config.mode === "fix" && context.isForkPR) {
    throw new Error(
      "mode=fix is disabled for fork pull requests. Fork PRs are reviewed read-only to avoid untrusted code writes.",
    );
  }
  if (context.config.allowFix && context.isForkPR) {
    core.warning(
      "allow_fix=true was requested on a fork pull request, but repository mutation tools will not be exposed.",
    );
  }
}
