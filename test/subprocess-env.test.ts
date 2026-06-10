import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { subprocessEnv } from "../src/utils/subprocess-env.js";
import type { ToolExecutionContext } from "../src/tools/types.js";

const ctx = {
  github: {
    config: { githubToken: "ghs_secrettoken", allowedNonWriteUsers: "" },
  },
} as unknown as Pick<ToolExecutionContext, "github">;

describe("subprocessEnv", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.NEOSANTARA_API_KEY = "nsk_supersecret";
    process.env.MY_CUSTOM_SECRET = "leaky";
    process.env.PATH = "/usr/bin";
    process.env.HOME = "/home/runner";
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("never leaks secrets into the default subprocess env", () => {
    const env = subprocessEnv(ctx);
    expect(env.NEOSANTARA_API_KEY).toBeUndefined();
    expect(env.MY_CUSTOM_SECRET).toBeUndefined();
    expect(env.GH_TOKEN).toBeUndefined();
    // Essential non-secret vars survive
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/runner");
  });

  it("injects GH_TOKEN only when explicitly requested", () => {
    const env = subprocessEnv(ctx, { githubToken: true });
    expect(env.GH_TOKEN).toBe("ghs_secrettoken");
    // Still no other secrets
    expect(env.NEOSANTARA_API_KEY).toBeUndefined();
  });
});
