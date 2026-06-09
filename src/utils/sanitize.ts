import { redact } from "./redact.js";

export function stripInvisibleCharacters(content: string): string {
  return content
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .replace(/\u00AD/g, "")
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, "");
}

export function stripMarkdownImageAltText(content: string): string {
  return content.replace(/!\[[^\]]*\]\(/g, "![](");
}

export function stripMarkdownLinkTitles(content: string): string {
  return content
    .replace(/(\[[^\]]*\]\([^)]+)\s+"[^"]*"/g, "$1")
    .replace(/(\[[^\]]*\]\([^)]+)\s+'[^']*'/g, "$1");
}

export function stripHiddenAttributes(content: string): string {
  return content
    .replace(/\salt\s*=\s*["'][^"']*["']/gi, "")
    .replace(/\salt\s*=\s*[^\s>]+/gi, "")
    .replace(/\stitle\s*=\s*["'][^"']*["']/gi, "")
    .replace(/\stitle\s*=\s*[^\s>]+/gi, "")
    .replace(/\saria-label\s*=\s*["'][^"']*["']/gi, "")
    .replace(/\saria-label\s*=\s*[^\s>]+/gi, "")
    .replace(/\sdata-[a-zA-Z0-9-]+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/\sdata-[a-zA-Z0-9-]+\s*=\s*[^\s>]+/gi, "")
    .replace(/\splaceholder\s*=\s*["'][^"']*["']/gi, "")
    .replace(/\splaceholder\s*=\s*[^\s>]+/gi, "");
}

export function normalizeHtmlEntities(content: string): string {
  return content
    .replace(/&#(\d+);/g, (_match, dec) => {
      const num = Number.parseInt(dec, 10);
      return num >= 32 && num <= 126 ? String.fromCharCode(num) : "";
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex) => {
      const num = Number.parseInt(hex, 16);
      return num >= 32 && num <= 126 ? String.fromCharCode(num) : "";
    });
}

export function stripHtmlComments(content: string): string {
  return content.replace(/<!--[\s\S]*?-->/g, "");
}

export function sanitizeContent(content: unknown): string {
  return redact(
    normalizeHtmlEntities(
      stripHiddenAttributes(
        stripMarkdownLinkTitles(
          stripMarkdownImageAltText(
            stripInvisibleCharacters(stripHtmlComments(String(content ?? ""))),
          ),
        ),
      ),
    ),
  );
}
