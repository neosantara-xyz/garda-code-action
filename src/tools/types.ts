import { z } from "zod";
import type { NeoContext } from "../github/context.js";
import type { GitHubData } from "../github/data.js";
import type { TrackingComment } from "../github/comments.js";
import type { GitHubClient } from "../github/types.js";

export type ToolExecutionContext = {
  octokit: GitHubClient;
  github: NeoContext;
  data: GitHubData;
  trackingComment: TrackingComment;
  setTrackingComment(comment: TrackingComment): void;
  inlineBuffer: InlineComment[];
};

export type InlineComment = {
  path: string;
  line: number;
  body: string;
  side?: "RIGHT" | "LEFT";
  start_line?: number;
  start_side?: "RIGHT" | "LEFT";
  confirmed?: boolean;
  classification?: {
    keep: boolean;
    severity?: "low" | "medium" | "high";
    reason?: string;
    model?: string;
  };
};

export type NeoTool = {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  readonly: boolean;
  execute(args: unknown, ctx: ToolExecutionContext): Promise<unknown>;
};

export function toolDefinition(tool: NeoTool) {
  return {
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: zodToJsonSchema(tool.schema),
    strict: false,
  };
}

// Small local converter for common zod objects. Parameters are simple and tested.
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      const child = value as z.ZodTypeAny;
      properties[key] = zodToJsonSchema(child);
      if (!child.isOptional()) required.push(key);
    }
    return {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    };
  }
  if (schema instanceof z.ZodString) return { type: "string" };
  if (schema instanceof z.ZodNumber) return { type: "number" };
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodArray)
    return { type: "array", items: zodToJsonSchema(schema.element) };
  if (schema instanceof z.ZodOptional) return zodToJsonSchema(schema.unwrap());
  if (schema instanceof z.ZodEnum)
    return { type: "string", enum: schema.options };
  return { type: "string" };
}
