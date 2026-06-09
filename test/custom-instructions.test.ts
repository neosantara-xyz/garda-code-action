import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../src/prompt/system.js";
import type { NeoContext } from "../src/github/context.js";

function ctx(customInstructions: string): NeoContext {
  return {
    eventName: "pull_request",
    eventAction: "opened",
    actor: "maintainer",
    runId: "1",
    repository: {
      owner: "o",
      repo: "r",
      fullName: "o/r",
      defaultBranch: "main",
    },
    config: {
      reviewLanguage: "id",
      prompt: "",
      customInstructions,
      allowFix: false,
      mode: "review",
      commitStrategy: "git",
    },
    isEntity: true,
    isPR: true,
    isIssue: false,
    isForkPR: false,
  } as unknown as NeoContext;
}

describe("custom instructions", () => {
  it("wraps trusted workflow custom instructions separately", () => {
    const prompt = buildSystemPrompt(ctx("Prioritaskan breaking change."));
    expect(prompt).toContain("<custom_instructions_trusted>");
    expect(prompt).toContain("Prioritaskan breaking change.");
    expect(prompt).toContain("trusted workflow custom_instructions");
  });
});
