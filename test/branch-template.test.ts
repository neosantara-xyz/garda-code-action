import { describe, expect, it, vi } from "vitest";
import { generateBranchName } from "../src/utils/branch-template.js";

const fixedDate = new Date("2026-06-09T01:02:00Z");

describe("branch template", () => {
  it("generates Claude-style templated issue branches", () => {
    vi.setSystemTime(fixedDate);
    try {
      expect(
        generateBranchName({
          template: "{{prefix}}{{entityType}}-{{entityNumber}}-{{description}}",
          branchPrefix: "garda/",
          entityType: "issue",
          entityNumber: 42,
          title: "Fix Login Error on Android",
        }),
      ).toBe("garda/issue-42-fix-login-error-on-android");
    } finally {
      vi.useRealTimers();
    }
  });
});
