import { readdir, readFile, stat, writeFile, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, relative, sep, dirname } from "node:path";
import { z } from "zod";
import { minimatch } from "minimatch";
import { execa } from "execa";
import type { NeoTool } from "./types.js";
import { redact } from "../utils/redact.js";
import { truncateText, splitList } from "../utils/text.js";
import { shouldIgnore } from "../github/data.js";
import { isRepositoryMutationAllowed } from "../github/permissions.js";
import { subprocessEnv } from "../utils/subprocess-env.js";

function repoRoot(): string {
  return process.env.GITHUB_WORKSPACE || process.cwd();
}

async function safePath(path: string, forWrite = false): Promise<string> {
  const root = resolve(repoRoot());
  const full = resolve(root, path);
  if (full !== root && !full.startsWith(`${root}${sep}`))
    throw new Error(`Path escapes repository: ${path}`);

  const realRoot = await realpath(root);
  if (existsSync(full)) {
    const realFull = await realpath(full);
    if (realFull !== realRoot && !realFull.startsWith(`${realRoot}${sep}`))
      throw new Error(`Path escapes repository via symlink: ${path}`);
    return realFull;
  }

  if (forWrite) {
    const parent = dirname(full);
    const realParent = await realpath(parent);
    if (realParent !== realRoot && !realParent.startsWith(`${realRoot}${sep}`))
      throw new Error(`Path parent escapes repository: ${path}`);
    return full;
  }

  return full;
}

async function walk(
  dir: string,
  ignoreInput: string,
  out: string[],
  max: number,
): Promise<void> {
  if (out.length >= max) return;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (out.length >= max) break;
    const full = resolve(dir, entry.name);
    const rel = relative(repoRoot(), full).split(sep).join("/");
    if (
      !rel ||
      shouldIgnore(rel, ignoreInput) ||
      shouldIgnore(`${rel}/**`, ignoreInput)
    )
      continue;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await walk(full, ignoreInput, out, max);
    else out.push(rel);
  }
}

export const repoTools: NeoTool[] = [
  {
    name: "repo_get_changed_files",
    description: "Return PR changed file metadata already fetched from GitHub.",
    schema: z.object({}),
    readonly: true,
    async execute(_args, ctx) {
      return ctx.data.changedFiles.map((file) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
      }));
    },
  },
  {
    name: "repo_get_diff",
    description:
      "Return the sanitized unified diff for the current PR, truncated by max_diff_chars.",
    schema: z.object({}),
    readonly: true,
    async execute(_args, ctx) {
      return ctx.data.diff || "No diff available for this event.";
    },
  },
  {
    name: "repo_list_files",
    description: "List files in the repository, respecting ignore patterns.",
    schema: z.object({
      pattern: z.string().optional(),
      max_files: z.number().optional(),
    }),
    readonly: true,
    async execute(args, ctx) {
      const parsed = this.schema.parse(args) as {
        pattern?: string;
        max_files?: number;
      };
      const files: string[] = [];
      await walk(
        repoRoot(),
        ctx.github.config.ignore,
        files,
        parsed.max_files ?? 200,
      );
      const matched = parsed.pattern
        ? files.filter((file) =>
            minimatch(file, parsed.pattern!, { dot: true }),
          )
        : files;
      return matched.slice(0, parsed.max_files ?? 200);
    },
  },
  {
    name: "repo_read_file",
    description:
      "Read a repository file. The path must stay inside GITHUB_WORKSPACE, including through symlinks.",
    schema: z.object({ path: z.string(), max_chars: z.number().optional() }),
    readonly: true,
    async execute(args, ctx) {
      const parsed = this.schema.parse(args) as {
        path: string;
        max_chars?: number;
      };
      if (shouldIgnore(parsed.path, ctx.github.config.ignore))
        throw new Error(`Path is ignored by action config: ${parsed.path}`);
      const full = await safePath(parsed.path);
      const st = await stat(full);
      if (!st.isFile()) throw new Error(`Not a file: ${parsed.path}`);
      const content = await readFile(full, "utf8");
      return redact(
        truncateText(
          content,
          parsed.max_chars ?? ctx.github.config.maxFileChars,
        ),
      );
    },
  },
  {
    name: "repo_grep",
    description:
      "Search repository files using ripgrep when available. Pattern is treated as a regular expression.",
    schema: z.object({
      pattern: z.string(),
      glob: z.string().optional(),
      max_results: z.number().optional(),
    }),
    readonly: true,
    async execute(args, ctx) {
      const parsed = this.schema.parse(args) as {
        pattern: string;
        glob?: string;
        max_results?: number;
      };
      const limit = parsed.max_results ?? 100;
      const rgArgs = [
        "--line-number",
        "--hidden",
        "--no-heading",
        "--color",
        "never",
        parsed.pattern,
      ];
      for (const ignore of splitList(ctx.github.config.ignore))
        rgArgs.push("-g", `!${ignore}`);
      if (parsed.glob) rgArgs.push("-g", parsed.glob);
      try {
        const { stdout } = await execa("rg", rgArgs, {
          cwd: repoRoot(),
          reject: false,
          env: subprocessEnv(ctx),
        });
        return redact(stdout.split("\n").slice(0, limit).join("\n"));
      } catch (error) {
        return `grep failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },
  {
    name: "repo_write_file",
    description: "Write a repository file. Disabled unless allow_fix=true.",
    schema: z.object({ path: z.string(), content: z.string() }),
    readonly: false,
    async execute(args, ctx) {
      if (!isRepositoryMutationAllowed(ctx.github))
        throw new Error(
          "repo_write_file is disabled. Requires allow_fix=true, mode=fix, and a non-fork pull request.",
        );
      const parsed = this.schema.parse(args) as {
        path: string;
        content: string;
      };
      if (shouldIgnore(parsed.path, ctx.github.config.ignore))
        throw new Error(`Path is ignored by action config: ${parsed.path}`);
      if (ctx.github.config.dryRun)
        return {
          dry_run: true,
          path: parsed.path,
          bytes: parsed.content.length,
        };
      await writeFile(
        await safePath(parsed.path, true),
        parsed.content,
        "utf8",
      );
      return { written: parsed.path, bytes: parsed.content.length };
    },
  },
];
