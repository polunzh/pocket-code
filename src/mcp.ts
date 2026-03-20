import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface, type Interface } from "node:readline";
import type { ToolDef } from "./llm.js";
import { printError } from "./ui.js";

// ── JSON-RPC helpers ─────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

// ── MCP Client (one per server) ──────────────────────────────────────

class McpClient {
  private proc: ChildProcess;
  private rl: Interface;
  private nextId = 1;
  private pending = new Map<number, {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
  }>();

  readonly name: string;
  tools: ToolDef[] = [];
  toolNames: string[] = [];

  constructor(name: string, command: string, args: string[]) {
    this.name = name;
    this.proc = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });

    this.rl = createInterface({ input: this.proc.stdout! });
    this.rl.on("line", (line) => this.onLine(line));

    this.proc.stderr?.on("data", (chunk: Buffer) => {
      printError(`[MCP:${name}] ${chunk.toString().trim()}`);
    });
  }

  private onLine(line: string) {
    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // ignore non-JSON lines
    }
    if (msg.id != null && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) {
        p.reject(new Error(`MCP error: ${msg.error.message}`));
      } else {
        p.resolve(msg.result);
      }
    }
  }

  private send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin!.write(JSON.stringify(msg) + "\n");
    });
  }

  private notify(method: string, params?: Record<string, unknown>) {
    const msg: JsonRpcRequest = { jsonrpc: "2.0", method, params };
    this.proc.stdin!.write(JSON.stringify(msg) + "\n");
  }

  async initialize(): Promise<void> {
    // 1. initialize request
    await this.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pocket-code", version: "0.1.0" },
    });

    // 2. initialized notification
    this.notify("notifications/initialized");

    // 3. tools/list
    const res = (await this.send("tools/list")) as {
      tools: Array<{
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
      }>;
    };

    // 4. Convert to OpenAI tool format
    for (const t of res.tools) {
      const toolName = `mcp_${this.name}_${t.name}`;
      this.toolNames.push(toolName);
      this.tools.push({
        type: "function",
        function: {
          name: toolName,
          description: t.description || t.name,
          parameters: t.inputSchema || { type: "object", properties: {} },
        },
      });
    }
  }

  async callTool(originalName: string, args: Record<string, unknown>): Promise<string> {
    const res = (await this.send("tools/call", { name: originalName, arguments: args })) as {
      content: Array<{ type: string; text?: string }>;
    };
    return res.content.map((c) => c.text || "").join("\n");
  }

  shutdown() {
    this.rl.close();
    this.proc.stdin!.end();
    this.proc.kill();
  }
}

// ── MCP Manager ──────────────────────────────────────────────────────

export class McpManager {
  private clients: McpClient[] = [];
  // Map from prefixed tool name → { client, originalName }
  private toolMap = new Map<string, { client: McpClient; originalName: string }>();

  async loadFromConfig(): Promise<{ tools: ToolDef[]; toolNames: string[] }> {
    let config: { mcpServers?: Record<string, { command: string; args?: string[] }> };
    try {
      const raw = await readFile(resolve("pocket.json"), "utf-8");
      config = JSON.parse(raw);
    } catch {
      return { tools: [], toolNames: [] }; // no config or invalid, skip
    }

    if (!config.mcpServers) return { tools: [], toolNames: [] };

    const allTools: ToolDef[] = [];
    const allNames: string[] = [];

    for (const [name, serverDef] of Object.entries(config.mcpServers)) {
      const client = new McpClient(name, serverDef.command, serverDef.args || []);
      try {
        await client.initialize();
        this.clients.push(client);

        allTools.push(...client.tools);
        allNames.push(...client.toolNames);

        // Build lookup map: "mcp_weather_getTemp" → { client, "getTemp" }
        for (const toolName of client.toolNames) {
          const originalName = toolName.replace(`mcp_${name}_`, "");
          this.toolMap.set(toolName, { client, originalName });
        }

        console.log(`MCP: ${name} connected (${client.toolNames.length} tools)`);
      } catch (err) {
        printError(`MCP: ${name} failed to initialize: ${err}`);
        client.shutdown();
      }
    }

    return { tools: allTools, toolNames: allNames };
  }

  async callTool(prefixedName: string, args: Record<string, unknown>): Promise<string> {
    const entry = this.toolMap.get(prefixedName);
    if (!entry) return `Error: MCP tool "${prefixedName}" not found`;
    return entry.client.callTool(entry.originalName, args);
  }

  isMcpTool(name: string): boolean {
    return this.toolMap.has(name);
  }

  shutdownAll() {
    for (const client of this.clients) client.shutdown();
  }
}
