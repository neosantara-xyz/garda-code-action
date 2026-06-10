import { escapeRegExp } from "../utils/text.js";
import { sanitizeContent } from "../utils/sanitize.js";
import type { NeoContext } from "./context.js";

export function containsTrigger(context: NeoContext): boolean {
  const { prompt, triggerPhrase, assigneeTrigger, labelTrigger } =
    context.config;
  if (prompt.trim()) return true;

  const phrase = triggerPhrase.trim();
  const regex = phrase
    ? new RegExp(`(^|\\s)${escapeRegExp(phrase)}([\\s.,!?;:]|$)`, "i")
    : null;
  const action = context.eventAction;
  const payload = context.payload;

  if (context.eventName === "issues" && action === "assigned") {
    const triggerUser = assigneeTrigger.replace(/^@/, "");
    if (triggerUser && payload.assignee?.login === triggerUser) return true;
  }

  if (
    (context.eventName === "issues" || context.eventName === "pull_request") &&
    action === "labeled"
  ) {
    if (labelTrigger && payload.label?.name === labelTrigger) return true;
  }

  if (!regex) return false;
  if (context.eventName === "issues") {
    return (
      regex.test(payload.issue?.title || "") ||
      regex.test(payload.issue?.body || "")
    );
  }
  if (
    context.eventName === "pull_request" ||
    context.eventName === "pull_request_target"
  ) {
    return (
      regex.test(payload.pull_request?.title || "") ||
      regex.test(payload.pull_request?.body || "")
    );
  }
  if (context.eventName === "issue_comment")
    return regex.test(payload.comment?.body || "");
  if (context.eventName === "pull_request_review") {
    if (
      context.eventAction &&
      !["submitted", "edited"].includes(context.eventAction)
    )
      return false;
    return regex.test(payload.review?.body || "");
  }
  if (context.eventName === "pull_request_review_comment")
    return regex.test(payload.comment?.body || "");
  return false;
}

export function extractUserRequest(context: NeoContext): string {
  const { prompt, triggerPhrase } = context.config;
  if (prompt.trim()) return prompt.trim();
  const raw =
    context.payload.comment?.body ??
    context.payload.review?.body ??
    context.payload.pull_request?.body ??
    context.payload.issue?.body ??
    "";
  // Use string indexOf instead of regex to avoid ReDoS with large bodies
  const phrase = triggerPhrase.trim();
  let cleaned = String(raw);
  if (phrase) {
    const idx = cleaned.toLowerCase().indexOf(phrase.toLowerCase());
    if (idx !== -1)
      cleaned = cleaned.slice(0, idx) + cleaned.slice(idx + phrase.length);
  }
  return (
    sanitizeContent(cleaned.trim()) ||
    "Review this context and help with the requested GitHub task."
  );
}
