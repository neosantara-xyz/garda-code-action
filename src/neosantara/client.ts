import * as core from "@actions/core";
import OpenAI from "openai";
import type { ActionConfig } from "../config.js";

export function createNeosantaraClient(config: ActionConfig): OpenAI {
  const apiKey = process.env.NEOSANTARA_API_KEY;
  if (!apiKey) {
    throw new Error(
      "NEOSANTARA_API_KEY secret is required after the action has been triggered.",
    );
  }
  core.setSecret(apiKey);
  return new OpenAI({
    apiKey,
    baseURL: config.neosantaraBaseUrl,
  });
}
