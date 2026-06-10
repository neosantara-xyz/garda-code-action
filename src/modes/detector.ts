import type { NeoContext } from "../github/context.js";
import { containsTrigger, extractUserRequest } from "../github/trigger.js";

export type ExecutionMode = "tag" | "agent" | "skip";

/**
 * Decide whether an auto-mode run should dynamically switch to fix mode.
 *
 * Fix mode commits changes, so it must only be entered on an explicit human
 * request. We therefore require:
 *   - mode "auto" with allow_fix enabled,
 *   - the run was triggered by a human comment/review (not an automatic PR
 *     open/synchronize event — there the "request" is just the PR body), and
 *   - the trigger phrase is present and the text asks for a fix/patch.
 *
 * This prevents a PR whose description merely contains the word "fix" from
 * silently turning a normal review into a fix run (which then skips).
 */
export function shouldSwitchToFixMode(context: NeoContext): boolean {
  if (context.config.mode !== "auto" || !context.config.allowFix) return false;

  const triggeredByComment = [
    "issue_comment",
    "pull_request_review",
    "pull_request_review_comment",
  ].includes(context.eventName);
  if (!triggeredByComment || !containsTrigger(context)) return false;

  const request = extractUserRequest(context);
  // Negation guards — do not switch when the user explicitly does NOT want
  // changes ("don't fix", "jangan perbaiki", "just explain").
  const negated =
    /\b(don'?t|do not|jangan|tidak usah|no need to|just explain|only explain|hanya jelaskan)\b[^.!?]*\b(fix|perbaiki|patch|change|ubah)\b/i.test(
      request,
    );
  if (negated) return false;

  return (
    /\bfix\b/i.test(request) ||
    /\bperbaiki\b/i.test(request) ||
    /\bpatch\b/i.test(request) ||
    /\bimplement\b/i.test(request) ||
    /\bperbaikan\b/i.test(request)
  );
}

export function detectExecutionMode(context: NeoContext): ExecutionMode {
  if (context.config.prompt.trim()) return "agent";
  if (context.config.mode !== "auto" && context.config.mode !== "review")
    return containsTrigger(context) || !context.isEntity ? "tag" : "skip";

  if (context.isEntity) {
    if (
      [
        "issue_comment",
        "pull_request_review",
        "pull_request_review_comment",
        "issues",
      ].includes(context.eventName)
    ) {
      return containsTrigger(context) ? "tag" : "skip";
    }
    if (context.eventName === "pull_request") {
      const action = context.eventAction || "";
      if (
        ["opened", "synchronize", "ready_for_review", "reopened"].includes(
          action,
        )
      )
        return "agent";
      return containsTrigger(context) ? "tag" : "skip";
    }
  }

  return context.config.prompt.trim() ? "agent" : "skip";
}
