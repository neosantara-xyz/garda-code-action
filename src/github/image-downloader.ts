import * as core from "@actions/core";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sanitizeContent } from "../utils/sanitize.js";
import type { NeoContext } from "./context.js";
import type { GitHubClient } from "./types.js";

const SERVER_URL = (
  process.env.GITHUB_SERVER_URL || "https://github.com"
).replace(/\/$/, "");
const escapedServer = SERVER_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MARKDOWN_IMAGE_REGEX = new RegExp(
  `!\\[[^\\]]*\\]\\((${escapedServer}\\/user-attachments\\/assets\\/[^)\\s]+)[^)]*\\)`,
  "gi",
);
const HTML_IMAGE_REGEX = new RegExp(
  `<img[^>]+src=["']([^"']*${escapedServer}\\/user-attachments\\/assets\\/[^"']+)["'][^>]*>`,
  "gi",
);

export type ImageSource = {
  type:
    | "issue_body"
    | "pr_body"
    | "issue_comment"
    | "review_comment"
    | "review_body"
    | "trigger_comment";
  id: string;
  body: string;
  pullNumber?: number;
  issueNumber?: number;
};

export type DownloadedCommentImage = {
  sourceType: ImageSource["type"];
  sourceId: string;
  originalUrl: string;
  localPath: string;
  mimeType: string;
  bytes: number;
  dataUrl: string;
};

export function extractGitHubUserAttachmentUrls(body: string): string[] {
  const markdown = [...String(body || "").matchAll(MARKDOWN_IMAGE_REGEX)].map(
    (match) => match[1],
  );
  const html = [...String(body || "").matchAll(HTML_IMAGE_REGEX)].map(
    (match) => match[1],
  );
  return [...new Set([...markdown, ...html].filter(Boolean))] as string[];
}

function extensionFromMime(mime: string): string {
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  return ".img";
}

function allowedMime(mime: string): boolean {
  return /^(image\/(png|jpeg|jpg|webp|gif))\b/i.test(mime);
}

function extractSignedUrls(bodyHtml: string): string[] {
  const privateUrls =
    bodyHtml.match(
      /https:\/\/private-user-images\.githubusercontent\.com\/[^"'<>\s]+/g,
    ) || [];
  const publicUrls =
    bodyHtml.match(
      new RegExp(
        `${escapedServer}\\/user-attachments\\/assets\\/[^"'<>\\s]+`,
        "g",
      ),
    ) || [];
  return [...new Set([...privateUrls, ...publicUrls])];
}

async function readHtmlBody(
  octokit: GitHubClient,
  ctx: NeoContext,
  source: ImageSource,
): Promise<string | undefined> {
  const owner = ctx.repository.owner;
  const repo = ctx.repository.repo;
  const mediaType = { format: "full+json" };
  switch (source.type) {
    case "issue_comment":
    case "trigger_comment": {
      const { data } = await octokit.rest.issues.getComment({
        owner,
        repo,
        comment_id: Number(source.id),
        mediaType,
      });
      return data.body_html;
    }
    case "review_comment": {
      const { data } = await octokit.rest.pulls.getReviewComment({
        owner,
        repo,
        comment_id: Number(source.id),
        mediaType,
      });
      return data.body_html;
    }
    case "review_body": {
      if (!source.pullNumber) return undefined;
      const { data } = await octokit.rest.pulls.getReview({
        owner,
        repo,
        pull_number: source.pullNumber,
        review_id: Number(source.id),
        mediaType,
      });
      return data.body_html;
    }
    case "issue_body":
    case "pr_body": {
      const issue_number =
        source.issueNumber || source.pullNumber || ctx.entityNumber;
      if (!issue_number) return undefined;
      const { data } = await octokit.rest.issues.get({
        owner,
        repo,
        issue_number,
        mediaType,
      });
      return data.body_html;
    }
    default:
      return undefined;
  }
}

export async function downloadCommentImages(
  octokit: GitHubClient,
  ctx: NeoContext,
  sources: ImageSource[],
): Promise<DownloadedCommentImage[]> {
  if (!ctx.config.includeImageContext) return [];
  const maxImages = Math.max(0, ctx.config.maxCommentImages);
  const maxBytes = Math.max(0, ctx.config.maxImageBytes);
  if (maxImages === 0 || maxBytes === 0) return [];

  const downloadsDir = join(
    process.env.RUNNER_TEMP || "/tmp",
    "garda-code-images",
  );
  await mkdir(downloadsDir, { recursive: true });

  const downloaded: DownloadedCommentImage[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    if (downloaded.length >= maxImages) break;
    const originalUrls = extractGitHubUserAttachmentUrls(source.body);
    if (originalUrls.length === 0) continue;

    let signedUrls: string[] = [];
    try {
      const html = await readHtmlBody(octokit, ctx, source);
      signedUrls = html ? extractSignedUrls(html) : [];
    } catch (error) {
      core.warning(
        `Could not resolve signed image URLs for ${source.type} ${source.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      continue;
    }

    for (let i = 0; i < originalUrls.length; i += 1) {
      if (downloaded.length >= maxImages) break;
      const originalUrl = originalUrls[i];
      if (!originalUrl || seen.has(originalUrl)) continue;
      const signedUrl = signedUrls[i] || originalUrl;
      seen.add(originalUrl);

      try {
        const response = await fetch(signedUrl, {
          headers: { "User-Agent": "garda-code-action" },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const mime =
          response.headers.get("content-type") || "application/octet-stream";
        if (!allowedMime(mime)) {
          core.warning(`Skipping unsupported comment image mime type: ${mime}`);
          continue;
        }
        const length = Number(response.headers.get("content-length") || "0");
        if (length && length > maxBytes) {
          core.warning(
            `Skipping comment image larger than max_image_bytes: ${length}`,
          );
          continue;
        }
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength > maxBytes) {
          core.warning(
            `Skipping comment image larger than max_image_bytes: ${arrayBuffer.byteLength}`,
          );
          continue;
        }
        const buffer = Buffer.from(arrayBuffer);
        const ext = extensionFromMime(mime);
        const localPath = join(
          downloadsDir,
          `image-${downloaded.length + 1}-${Date.now()}${ext}`,
        );
        await writeFile(localPath, buffer);
        const cleanMime = mime.split(";")[0] || mime;
        downloaded.push({
          sourceType: source.type,
          sourceId: source.id,
          originalUrl: sanitizeContent(originalUrl),
          localPath,
          mimeType: cleanMime,
          bytes: buffer.byteLength,
          dataUrl: `data:${cleanMime};base64,${buffer.toString("base64")}`,
        });
      } catch (error) {
        core.warning(
          `Failed to download comment image ${sanitizeContent(originalUrl)}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  return downloaded;
}
