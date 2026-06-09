import { describe, expect, it } from "vitest";
import type OpenAI from "openai";
import { classifyBufferedInlineComments } from "../src/neosantara/inline-classifier.js";
import type { NeoContext } from "../src/github/context.js";
import type { GitHubData } from "../src/github/data.js";

function ctx(mode: "heuristic" | "model" | "off" = "heuristic") {
  return {
    repository: { owner: "o", repo: "r", fullName: "o/r" },
    entityNumber: 1,
    config: {
      classifyInlineComments: true,
      inlineClassifierMode: mode,
      inlineClassifierModel: "classifier-model",
      minInlineSeverity: "medium",
      reviewLanguage: "id",
      customInstructions: "",
    },
  } as unknown as NeoContext;
}

const data = {
  changedFiles: [
    {
      filename: "src/a.ts",
      status: "modified",
      additions: 1,
      deletions: 0,
      changes: 1,
      patch: "@@ -1 +1 @@\n-foo\n+bar",
    },
  ],
} as unknown as GitHubData;

describe("inline classifier", () => {
  it("heuristically rejects probes and low severity when min severity is medium", async () => {
    const result = await classifyBufferedInlineComments({
      context: ctx("heuristic"),
      data,
      comments: [
        { path: "src/a.ts", line: 1, body: "Test comment" },
        {
          path: "src/a.ts",
          line: 1,
          body: "This null check can throw when profile is missing.",
        },
        { path: "src/a.ts", line: 1, body: "Consider renaming this variable." },
      ],
    });
    expect(result.usedModel).toBe(false);
    expect(result.skipped).toBe(2);
    expect(result.comments.map((c) => c.confirmed)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("uses model decisions when enabled", async () => {
    const calls: unknown[] = [];
    const client = {
      responses: {
        create: async (body: unknown) => {
          calls.push(body);
          return {
            output_text: JSON.stringify({
              decisions: [
                { index: 0, keep: true, severity: "high", reason: "real bug" },
                {
                  index: 1,
                  keep: false,
                  severity: "low",
                  reason: "style only",
                },
              ],
            }),
          };
        },
      },
    } as unknown as OpenAI;
    const result = await classifyBufferedInlineComments({
      client,
      context: ctx("model"),
      data,
      comments: [
        { path: "src/a.ts", line: 1, body: "Can crash on undefined user." },
        { path: "src/a.ts", line: 1, body: "Maybe rename this." },
      ],
    });
    expect(calls).toHaveLength(1);
    expect(result.usedModel).toBe(true);
    expect(result.comments.map((c) => c.confirmed)).toEqual([true, false]);
    expect(result.comments.at(0)?.classification?.model).toBe(
      "classifier-model",
    );
  });
});
