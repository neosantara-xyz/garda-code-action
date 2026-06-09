import type { NeoContext } from "../github/context.js";
import { containsTrigger } from "../github/trigger.js";

export type ExecutionMode = "tag" | "agent" | "skip";

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
