import * as core from "@actions/core";
import type OpenAI from "openai";
import type { NeoContext } from "../github/context.js";
import type { GitHubData } from "../github/data.js";
import type { InlineComment } from "../tools/types.js";
import { redact } from "../utils/redact.js";
import { sanitizeContent } from "../utils/sanitize.js";
import { truncateText } from "../utils/text.js";

type ClassifierDecision = {
  index: number;
  keep: boolean;
  severity?: "low" | "medium" | "high";
  reason?: string;
};

export type InlineClassifierResult = {
  comments: InlineComment[];
  decisions: ClassifierDecision[];
  usedModel: boolean;
  skipped: number;
};

const severityRank = { low: 1, medium: 2, high: 3 } as const;

type ClassifierResponseContent = { type?: string; text?: string };
type ClassifierResponseOutput = {
  type?: string;
  content?: ClassifierResponseContent[];
};
type ClassifierResponse = {
  output_text?: string;
  output?: ClassifierResponseOutput[];
};
type DecisionRecord = {
  index?: unknown;
  keep?: unknown;
  severity?: unknown;
  reason?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decisionArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (isRecord(raw) && Array.isArray(raw.decisions)) return raw.decisions;
  return [];
}

function minSeverityAllowed(
  severity: string | undefined,
  min: "low" | "medium" | "high",
): boolean {
  const value = (severity || "low") as keyof typeof severityRank;
  return (severityRank[value] || 1) >= severityRank[min];
}

function looksLikeProbeComment(body: string): boolean {
  const normalized = body.trim().toLowerCase();
  if (!normalized) return true;
  const probePatterns = [
    /^test comment\b/,
    /^testing\b/,
    /^checking if\b/,
    /^can i (post|comment|create)/,
    /^does this work\b/,
    /^probe\b/,
    /^placeholder\b/,
    /tool.*(works|test|probe)/,
  ];
  return probePatterns.some((pattern) => pattern.test(normalized));
}

function heuristicDecision(
  comment: InlineComment,
  index: number,
  minSeverity: "low" | "medium" | "high",
): ClassifierDecision {
  if (comment.confirmed === false) {
    return {
      index,
      keep: false,
      severity: "low",
      reason: "Tool caller marked confirmed=false",
    };
  }
  if (looksLikeProbeComment(comment.body)) {
    return {
      index,
      keep: false,
      severity: "low",
      reason: "Looks like a tool probe/test comment",
    };
  }
  const body = comment.body.toLowerCase();
  const severity =
    /security|vulnerab|leak|token|secret|crash|data loss|race|corrupt|panic/.test(
      body,
    )
      ? "high"
      : /bug|broken|incorrect|fail|regression|edge case|null|undefined/.test(
            body,
          )
        ? "medium"
        : "low";
  return {
    index,
    keep: minSeverityAllowed(severity, minSeverity),
    severity,
    reason: "Heuristic classifier",
  };
}

function extractOutputText(response: ClassifierResponse): string {
  if (typeof response.output_text === "string") return response.output_text;
  const parts: string[] = [];
  for (const item of response.output || []) {
    if (item.type === "message") {
      for (const content of item.content || []) {
        if (content.type === "output_text" || content.type === "text")
          parts.push(content.text || "");
      }
    }
  }
  return parts.join("\n").trim();
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) return JSON.parse(fenced);
    const array = trimmed.match(/\[[\s\S]*\]/)?.[0];
    if (array) return JSON.parse(array);
    throw new Error("Classifier response was not valid JSON.");
  }
}

function normalizeDecisions(raw: unknown, count: number): ClassifierDecision[] {
  const value = decisionArray(raw);
  const decisions: ClassifierDecision[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const record = item as DecisionRecord;
    const index = Number(record.index);
    if (!Number.isInteger(index) || index < 0 || index >= count) continue;
    const severity = ["low", "medium", "high"].includes(String(record.severity))
      ? (record.severity as "low" | "medium" | "high")
      : "low";
    decisions.push({
      index,
      keep: Boolean(record.keep),
      severity,
      reason: String(record.reason || "model classifier"),
    });
  }
  const seen = new Set(decisions.map((d) => d.index));
  for (let i = 0; i < count; i += 1) {
    if (!seen.has(i))
      decisions.push({
        index: i,
        keep: false,
        severity: "low",
        reason: "No model decision returned",
      });
  }
  return decisions.sort((a, b) => a.index - b.index);
}

function buildClassifierInput(
  context: NeoContext,
  data: GitHubData,
  comments: InlineComment[],
): string {
  const changedFiles = data.changedFiles.map((file) => ({
    path: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    patch: truncateText(file.patch || "", 12000),
  }));
  const candidates = comments.map((comment, index) => ({
    index,
    path: comment.path,
    line: comment.line,
    side: comment.side || "RIGHT",
    body: sanitizeContent(comment.body),
  }));
  return JSON.stringify({
    repository: context.repository.fullName,
    pull_request: context.entityNumber,
    review_language: context.config.reviewLanguage,
    min_inline_severity: context.config.minInlineSeverity,
    changed_files: changedFiles,
    candidate_comments: candidates,
  });
}

async function classifyWithModel(params: {
  client: OpenAI;
  context: NeoContext;
  data: GitHubData;
  comments: InlineComment[];
}): Promise<ClassifierDecision[]> {
  const input = buildClassifierInput(
    params.context,
    params.data,
    params.comments,
  );
  const response = (await params.client.responses.create({
    model: params.context.config.inlineClassifierModel,
    store: false,
    input: [
      {
        role: "system",
        content:
          'You are a strict PR inline comment classifier. Keep only high-signal review comments that identify a concrete correctness, security, regression, test, or maintainability issue tied to a changed line. Reject tool probes, vague praise, duplicate/generic comments, style-only nitpicks, and comments not supported by the supplied diff. Return JSON only: {"decisions":[{"index":0,"keep":true,"severity":"low|medium|high","reason":"short reason"}]}',
      },
      { role: "user", content: input },
    ],
  } as never)) as unknown as ClassifierResponse;
  const text = extractOutputText(response);
  return normalizeDecisions(parseJson(text), params.comments.length);
}

export async function classifyBufferedInlineComments(params: {
  client?: OpenAI;
  context: NeoContext;
  data: GitHubData;
  comments: InlineComment[];
}): Promise<InlineClassifierResult> {
  const { context, comments } = params;
  if (
    !context.config.classifyInlineComments ||
    context.config.inlineClassifierMode === "off"
  ) {
    return { comments, decisions: [], usedModel: false, skipped: 0 };
  }

  let decisions = comments.map((comment, index) =>
    heuristicDecision(comment, index, context.config.minInlineSeverity),
  );
  let usedModel = false;

  if (
    context.config.inlineClassifierMode === "model" &&
    params.client &&
    comments.length > 0
  ) {
    try {
      decisions = await classifyWithModel({
        client: params.client,
        context,
        data: params.data,
        comments,
      });
      usedModel = true;
    } catch (error) {
      core.warning(
        `Model inline classifier failed, falling back to heuristic: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const byIndex = new Map(
    decisions.map((decision) => [decision.index, decision]),
  );
  let skipped = 0;
  const classified = comments.map((comment, index) => {
    const decision = byIndex.get(index) || {
      index,
      keep: false,
      severity: "low",
      reason: "missing decision",
    };
    const keep =
      decision.keep &&
      minSeverityAllowed(decision.severity, context.config.minInlineSeverity);
    if (!keep) skipped += 1;
    return {
      ...comment,
      confirmed: keep,
      body: redact(comment.body),
      classification: {
        keep,
        severity: decision.severity || "low",
        reason: truncateText(redact(decision.reason || ""), 500),
        model: usedModel ? context.config.inlineClassifierModel : "heuristic",
      },
    } satisfies InlineComment;
  });

  return { comments: classified, decisions, usedModel, skipped };
}
