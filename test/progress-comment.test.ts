import { describe, expect, it } from "vitest";
import { renderProgress } from "../src/github/comments.js";
import type { NeoContext } from "../src/github/context.js";

function ctx(lang = "id"): NeoContext {
  return {
    runUrl: "https://github.com/o/r/actions/runs/1",
    config: { reviewLanguage: lang },
  } as unknown as NeoContext;
}

describe("renderProgress", () => {
  it("renders a single title, spinner, and workflow-run link", () => {
    const out = renderProgress(ctx(), "running");
    expect(out.split("sedang bekerja").length - 1).toBe(1);
    expect(out.split("garda-spinner.gif").length - 1).toBe(1);
    expect(out.split("[View workflow run]").length - 1).toBe(1);
  });

  it("is idempotent when the model echoes the title/spinner/link back", () => {
    // Simulate the model passing back a fully-rendered comment as its status.
    const echoed = renderProgress(ctx(), "- [x] Trigger validated");
    const out = renderProgress(ctx(), echoed);
    // Title, spinner, and link must each still appear exactly once.
    expect(out.split("sedang bekerja").length - 1).toBe(1);
    expect(out.split("garda-spinner.gif").length - 1).toBe(1);
    expect(out.split("[View workflow run]").length - 1).toBe(1);
    expect(out.split("<!-- garda-code-action-comment -->").length - 1).toBe(1);
    // The actual status content survives.
    expect(out).toContain("Trigger validated");
  });

  it("strips an echoed English title too", () => {
    const echoed = renderProgress(ctx("en"), "Reviewing changes");
    const out = renderProgress(ctx("en"), echoed);
    expect(out.split("is working").length - 1).toBe(1);
    expect(out).toContain("Reviewing changes");
  });
});
