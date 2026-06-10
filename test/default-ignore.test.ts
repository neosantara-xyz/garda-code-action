import { describe, expect, it } from "vitest";
import { DEFAULT_IGNORE_PATTERNS } from "../src/config.js";
import { shouldIgnore } from "../src/github/data.js";

const ignore = DEFAULT_IGNORE_PATTERNS.join(",");

describe("DEFAULT_IGNORE_PATTERNS", () => {
  it("ignores secret files", () => {
    expect(shouldIgnore(".env", ignore)).toBe(true);
    expect(shouldIgnore("config/.env.production", ignore)).toBe(true);
    expect(shouldIgnore("certs/server.pem", ignore)).toBe(true);
    expect(shouldIgnore("deploy/id_rsa", ignore)).toBe(true);
    expect(shouldIgnore(".npmrc", ignore)).toBe(true);
  });

  it("ignores generated/build/dependency dirs", () => {
    expect(shouldIgnore("node_modules/foo/index.js", ignore)).toBe(true);
    expect(shouldIgnore("dist/bundle.js", ignore)).toBe(true);
    expect(shouldIgnore("packages/web/.next/server/x.js", ignore)).toBe(true);
  });

  it("ignores lock files", () => {
    expect(shouldIgnore("package-lock.json", ignore)).toBe(true);
    expect(shouldIgnore("pnpm-lock.yaml", ignore)).toBe(true);
    expect(shouldIgnore("Cargo.lock", ignore)).toBe(true);
  });

  it("does not ignore normal source files", () => {
    expect(shouldIgnore("src/index.ts", ignore)).toBe(false);
    expect(shouldIgnore("README.md", ignore)).toBe(false);
    expect(shouldIgnore("lib/auth.ts", ignore)).toBe(false);
  });
});
