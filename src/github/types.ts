import type * as github from "@actions/github";

export type GitHubClient = ReturnType<typeof github.getOctokit>;

export type GitHubUser = {
  login?: string | null;
  type?: string | null;
};

export type CommentLike = {
  id?: number;
  body?: string | null;
  html_url?: string;
  user?: GitHubUser | null;
  created_at?: string | null;
  updated_at?: string | null;
  submitted_at?: string | null;
  path?: string | null;
  line?: number | null;
  original_line?: number | null;
};

export type RepoRef = {
  ref?: string;
  sha?: string;
  repo?: {
    full_name?: string;
  } | null;
};

export type EntityLike = {
  id?: number;
  number?: number;
  title?: string | null;
  body?: string | null;
  html_url?: string;
  user?: GitHubUser | null;
  author?: GitHubUser | null;
  pull_request?: unknown;
  labels?: Array<string | { name?: string }>;
  repository?: { default_branch?: string };
  head?: RepoRef;
  base?: RepoRef;
};

export type GardaPayload = {
  action?: string;
  repository?: {
    full_name?: string;
    default_branch?: string;
  };
  issue?: EntityLike;
  pull_request?: EntityLike;
  comment?: CommentLike;
  review?: CommentLike;
  label?: {
    name?: string;
  };
  assignee?: {
    login?: string;
  };
  inputs?: Record<string, unknown>;
  client_payload?: Record<string, unknown>;
};

export type CiStatus = {
  total: number;
  runs: Array<{
    id: number;
    name: string;
    status: string | null;
    conclusion: string | null;
    html_url: string | null;
  }>;
};

export type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function numberField(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
