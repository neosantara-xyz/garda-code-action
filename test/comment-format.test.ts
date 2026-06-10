import { describe, expect, it } from "vitest";
import {
  formatDuration,
  buildActionBar,
  composeFinalComment,
} from "../src/github/comment-format.js";
import type { NeoContext } from "../src/github/context.js";
import type { BranchFinalization } from "../src/github/branch-cleanup.js";

const ctx = {
  actor: "alice",
  runUrl: "https://github.com/o/r/actions/runs/1",
} as unknown as NeoContext;

describe("formatDuration", () => {
  it("formats seconds only", () => {
    expect(formatDuration(5000)).toBe("5s");
  });
  it("formats minutes and seconds", () => {
    expect(formatDuration(125000)).toBe("2m 5s");
  });
});

describe("buildActionBar", () => {
  it("includes only the workflow run link when no branch", () => {
    const bar = buildActionBar(ctx, {
      hasChanges: false,
      deleted: false,
    } as BranchFinalization);
    expect(bar).toContain("[View workflow run]");
    expect(bar).not.toContain("Create PR");
  });

  it("includes branch and Create PR links when changes exist", () => {
    const bar = buildActionBar(ctx, {
      branchName: "garda/issue-1",
      branchUrl: "https://github.com/o/r/tree/garda/issue-1",
      createPrUrl: "https://github.com/o/r/compare/main...garda/issue-1",
      hasChanges: true,
      deleted: false,
    });
    expect(bar).toContain("[`garda/issue-1`]");
    expect(bar).toContain("[Create PR ➔]");
    expect(bar).toContain(" • ");
  });
});

describe("composeFinalComment", () => {
  it("renders a glanceable success header with @user and duration", () => {
    const out = composeFinalComment({
      context: ctx,
      actor: "alice",
      durationMs: 65000,
      branch: { hasChanges: false, deleted: false },
      resultText: "All good.",
      details: "<details>x</details>",
    });
    expect(out).toContain("**Garda finished @alice's task in 1m 5s**");
    expect(out).toContain("All good.");
    expect(out).toContain("[View workflow run]");
  });

  it("renders an error header with duration and error block", () => {
    const out = composeFinalComment({
      context: ctx,
      actor: "alice",
      durationMs: 3000,
      branch: { hasChanges: false, deleted: false },
      resultText: "",
      details: "",
      failed: true,
      errorDetails: "boom",
    });
    expect(out).toContain("**Garda encountered an error after 3s**");
    expect(out).toContain("boom");
  });

  it("notes deleted empty branch", () => {
    const out = composeFinalComment({
      context: ctx,
      actor: "alice",
      durationMs: 1000,
      branch: { branchName: "garda/issue-2", hasChanges: false, deleted: true },
      resultText: "done",
      details: "",
    });
    expect(out).toContain("was deleted because no changes were committed");
  });
});
