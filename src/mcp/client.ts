import { z } from "zod";
import { spawn, type ChildProcess } from "node:child_process";
import * as readline from "node:readline";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as core from "@actions/core";
import type { NeoTool, ToolExecutionContext } from "../tools/types.js";

export interface McpServerConfig {
  command?: string;
  server_url?: string;
  authorization_token?: string;
  args?: string[];
  env?: Record<string, string>;
  require_approval?: "never" | "always";
}

export interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>;
}

export function buildNativeMcpTools(
  config: McpConfig,
): Array<Record<string, unknown>> {
  return Object.entries(config.mcpServers || {})
    .filter(([, s]) => s.server_url)
    .map(([label, s]) => ({
      type: "mcp",
      server_label: label,
      server_url: s.server_url,
      require_approval: s.require_approval ?? "never",
      ...(s.authorization_token
        ? { authorization_token: s.authorization_token }
        : {}),
    }));
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: any;
}

function jsonSchemaToZod(jsonSchema: any): z.ZodTypeAny {
  if (!jsonSchema) return z.object({}).passthrough();

  if (jsonSchema.type === "object" || jsonSchema.properties) {
    const properties = jsonSchema.properties || {};
    const required = jsonSchema.required || [];
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [key, prop] of Object.entries(properties)) {
      let fieldSchema = jsonSchemaToZod(prop);
      if (!required.includes(key)) {
        fieldSchema = fieldSchema.optional();
      }
      shape[key] = fieldSchema;
    }
    return z.object(shape);
  }

  if (jsonSchema.type === "array") {
    return z.array(jsonSchemaToZod(jsonSchema.items || {}));
  }

  if (jsonSchema.type === "string") {
    if (Array.isArray(jsonSchema.enum) && jsonSchema.enum.length > 0) {
      return z.enum(jsonSchema.enum as [string, ...string[]]);
    }
    return z.string();
  }

  if (jsonSchema.type === "number" || jsonSchema.type === "integer") {
    return z.number();
  }

  if (jsonSchema.type === "boolean") {
    return z.boolean();
  }

  return z.any();
}

export class McpClient {
  private process: ChildProcess | null = null;
  private pendingRequests = new Map<
    number | string,
    { resolve: (val: any) => void; reject: (err: Error) => void }
  >();
  private nextId = 1;
  private rl: readline.Interface | null = null;

  constructor(
    public readonly serverName: string,
    private readonly config: McpServerConfig,
  ) {}

  public async start(): Promise<McpTool[]> {
    return new Promise<McpTool[]>((resolve, reject) => {
      let resolved = false;

      const env = { ...process.env, ...(this.config.env || {}) };
      this.process = spawn(this.config.command!, this.config.args || [], {
        env,
        stdio: ["pipe", "pipe", "inherit"],
      });

      this.process.on("error", (err) => {
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });

      this.process.on("exit", (code) => {
        for (const pending of this.pendingRequests.values()) {
          pending.reject(
            new Error(`MCP server process exited with code ${code}`),
          );
        }
        this.pendingRequests.clear();
        if (!resolved) {
          resolved = true;
          reject(new Error(`MCP server exited with code ${code}`));
        }
      });

      this.rl = readline.createInterface({
        input: this.process.stdout!,
        crlfDelay: Infinity,
      });

      this.rl.on("line", (line) => {
        try {
          const message = JSON.parse(line);
          if (message.id !== undefined) {
            const pending = this.pendingRequests.get(message.id);
            if (pending) {
              this.pendingRequests.delete(message.id);
              if (message.error) {
                pending.reject(
                  new Error(
                    message.error.message || JSON.stringify(message.error),
                  ),
                );
              } else {
                pending.resolve(message.result);
              }
            }
          }
        } catch (err) {
          // Ignore parsing errors
        }
      });

      // Execute handshake
      (async () => {
        try {
          await this.sendRequest("initialize", {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: {
              name: "garda-code-action",
              version: "0.1.10",
            },
          });
          this.sendNotification("initialized");
          const toolsResult = await this.sendRequest("tools/list", {});
          const tools = (toolsResult?.tools || []) as McpTool[];
          resolved = true;
          resolve(tools);
        } catch (err) {
          resolved = true;
          reject(err);
        }
      })();
    });
  }

  public async callTool(
    toolName: string,
    args: Record<string, any>,
  ): Promise<any> {
    return this.sendRequest("tools/call", {
      name: toolName,
      arguments: args,
    });
  }

  public async stop(): Promise<void> {
    if (this.rl) {
      this.rl.close();
    }
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  private sendRequest(method: string, params: any): Promise<any> {
    const id = this.nextId++;
    const request = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      if (!this.process || !this.process.stdin) {
        return reject(new Error("Process not running"));
      }
      this.process.stdin.write(JSON.stringify(request) + "\n");
    });
  }

  private sendNotification(method: string, params?: any): void {
    const notification = {
      jsonrpc: "2.0",
      method,
      params,
    };
    if (this.process && this.process.stdin) {
      this.process.stdin.write(JSON.stringify(notification) + "\n");
    }
  }
}

export async function loadAndStartMcpServers(
  existingToolNames: Set<string>,
): Promise<{ tools: NeoTool[]; stopAll: () => Promise<void> }> {
  const cwd = process.env.GITHUB_WORKSPACE || process.cwd();
  const configPath = join(cwd, ".mcp.json");

  if (!existsSync(configPath)) {
    return { tools: [], stopAll: async () => {} };
  }

  let mcpConfig: McpConfig;
  try {
    const content = readFileSync(configPath, "utf8");
    mcpConfig = JSON.parse(content);
  } catch (err) {
    core.warning(
      `Failed to parse .mcp.json file: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { tools: [], stopAll: async () => {} };
  }

  const servers = mcpConfig.mcpServers || {};
  const activeClients: McpClient[] = [];
  const registeredTools: NeoTool[] = [];

  for (const [serverName, serverConfig] of Object.entries(servers)) {
    if (!serverConfig.command) {
      if (serverConfig.server_url)
        core.info(
          `MCP server ${serverName} uses native server_url — skipping local spawn.`,
        );
      else
        core.warning(
          `MCP server ${serverName} has no command or server_url configured. Skipping.`,
        );
      continue;
    }
    core.info(`Starting MCP server: ${serverName}`);
    const client = new McpClient(serverName, serverConfig);
    try {
      const tools = await client.start();
      activeClients.push(client);
      core.info(
        `✓ MCP server ${serverName} started. Found ${tools.length} tools.`,
      );

      for (const tool of tools) {
        let registeredName = tool.name;
        if (existingToolNames.has(registeredName)) {
          registeredName = `mcp_${serverName}_${tool.name}`;
        }
        existingToolNames.add(registeredName);

        registeredTools.push({
          name: registeredName,
          description: tool.description || "",
          schema: jsonSchemaToZod(tool.inputSchema),
          readonly: false,
          async execute(args: any, _ctx: ToolExecutionContext) {
            const result = await client.callTool(tool.name, args);
            if (result && Array.isArray(result.content)) {
              const parts = [];
              for (const item of result.content) {
                if (item.type === "text") {
                  parts.push(item.text);
                } else {
                  parts.push(JSON.stringify(item));
                }
              }
              return parts.join("\n");
            }
            return JSON.stringify(result);
          },
        });
      }
    } catch (err) {
      core.warning(
        `Failed to start MCP server ${serverName}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await client.stop();
    }
  }

  const stopAll = async () => {
    for (const client of activeClients) {
      try {
        await client.stop();
        core.info(`Stopped MCP server: ${client.serverName}`);
      } catch (err) {
        // Ignore
      }
    }
  };

  return { tools: registeredTools, stopAll };
}
