import { describe, expect, it } from "vitest";
import { validateBranchName } from "../src/github/trusted-config.js";

describe("trusted config branch validation", () => {
  it("accepts normal branch names", () => {
    expect(() => validateBranchName("main")).not.toThrow();
    expect(() => validateBranchName("release/v1")).not.toThrow();
  });

  it("rejects unsafe branch names", () => {
    expect(() => validateBranchName("../main")).toThrow();
    expect(() => validateBranchName("main;rm -rf /")).toThrow();
    expect(() => validateBranchName("feature@{bad}")).toThrow();
  });
});
