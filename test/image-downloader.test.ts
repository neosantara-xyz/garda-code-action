import { describe, expect, it } from "vitest";
import { extractGitHubUserAttachmentUrls } from "../src/github/image-downloader.js";

const url = "https://github.com/user-attachments/assets/abc-123.png";

describe("GitHub image extraction", () => {
  it("extracts GitHub user attachment URLs from markdown images", () => {
    expect(extractGitHubUserAttachmentUrls(`![ignore me](${url})`)).toEqual([
      url,
    ]);
  });

  it("extracts GitHub user attachment URLs from html images", () => {
    expect(
      extractGitHubUserAttachmentUrls(`<img alt="hidden" src="${url}">`),
    ).toEqual([url]);
  });

  it("ignores non GitHub user attachment URLs", () => {
    expect(
      extractGitHubUserAttachmentUrls("![x](https://example.com/a.png)"),
    ).toEqual([]);
  });
});
