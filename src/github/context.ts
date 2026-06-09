import * as github from "@actions/github";
import type { ActionConfig } from "../config.js";
import type { GardaPayload } from "./types.js";

export type NeoContext = {
  eventName: string;
  eventAction?: string;
  actor: string;
  runId: string;
  runUrl: string;
  repository: {
    owner: string;
    repo: string;
    fullName: string;
    defaultBranch?: string;
  };
  payload: GardaPayload;
  isEntity: boolean;
  isPR: boolean;
  isForkPR: boolean;
  isPullRequestTarget: boolean;
  entityNumber?: number;
  baseBranch?: string;
  headBranch?: string;
  baseRepoFullName?: string;
  headRepoFullName?: string;
  headSha?: string;
  workingBranch?: string;
  createdBranch?: boolean;
  baseSha?: string;
  config: ActionConfig;
};

export function buildContextFromPayload(params: {
  config: ActionConfig;
  eventName: string;
  eventAction?: string;
  actor: string;
  payload: GardaPayload;
  repository?: {
    owner: string;
    repo: string;
    fullName: string;
    defaultBranch?: string;
  };
  runId?: string;
}): NeoContext {
  const payload = params.payload || {};
  const repository =
    params.repository ||
    (() => {
      const fullName =
        payload.repository?.full_name ||
        process.env.GITHUB_REPOSITORY ||
        "unknown/unknown";
      const [owner = "unknown", repo = "unknown"] = fullName.split("/");
      return {
        owner,
        repo,
        fullName: `${owner}/${repo}`,
        defaultBranch: payload.repository?.default_branch,
      };
    })();

  let isEntity = false;
  let isPR = false;
  let entityNumber: number | undefined;

  switch (params.eventName) {
    case "issues":
      isEntity = true;
      isPR = false;
      entityNumber = payload.issue?.number;
      break;
    case "issue_comment":
      isEntity = true;
      isPR = Boolean(payload.issue?.pull_request);
      entityNumber = payload.issue?.number;
      break;
    case "pull_request":
    case "pull_request_target":
      isEntity = true;
      isPR = true;
      entityNumber = payload.pull_request?.number;
      break;
    case "pull_request_review":
      isEntity = true;
      isPR = true;
      entityNumber = payload.pull_request?.number;
      break;
    case "pull_request_review_comment":
      isEntity = true;
      isPR = true;
      entityNumber = payload.pull_request?.number;
      break;
    default:
      break;
  }

  const pr = payload.pull_request;
  const baseRepoFullName =
    pr?.base?.repo?.full_name || (isPR ? repository.fullName : undefined);
  const headRepoFullName =
    pr?.head?.repo?.full_name || (isPR ? repository.fullName : undefined);
  const isForkPR = Boolean(
    isPR &&
    baseRepoFullName &&
    headRepoFullName &&
    baseRepoFullName !== headRepoFullName,
  );
  const runId = params.runId || process.env.GITHUB_RUN_ID || "";

  return {
    eventName: params.eventName,
    eventAction: params.eventAction || payload.action,
    actor: params.actor,
    runId,
    runUrl: `https://github.com/${repository.fullName}/actions/runs/${runId}`,
    repository,
    payload,
    isEntity,
    isPR,
    isForkPR,
    isPullRequestTarget: params.eventName === "pull_request_target",
    entityNumber,
    baseBranch:
      pr?.base?.ref || params.config.baseBranch || repository.defaultBranch,
    headBranch: pr?.head?.ref,
    baseRepoFullName,
    headRepoFullName,
    headSha: pr?.head?.sha,
    baseSha: pr?.base?.sha,
    config: params.config,
  };
}

export function parseContext(config: ActionConfig): NeoContext {
  const ctx = github.context;
  const repo = {
    owner: ctx.repo.owner,
    repo: ctx.repo.repo,
    fullName: `${ctx.repo.owner}/${ctx.repo.repo}`,
    defaultBranch: ctx.payload.repository?.default_branch,
  };

  return buildContextFromPayload({
    config,
    eventName: ctx.eventName,
    eventAction: ctx.payload.action,
    actor: ctx.actor,
    payload: ctx.payload,
    repository: repo,
    runId: process.env.GITHUB_RUN_ID || "",
  });
}
