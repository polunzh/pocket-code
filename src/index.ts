#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { LLMConfig } from "./llm.js";
import { Agent } from "./agent.js";
import { McpManager } from "./mcp.js";
import { initReadline, question, printError } from "./ui.js";

// ── Parse CLI args ───────────────────────────────────────────────────

function parseArgs(argv: string[]): { model: string; baseUrl: string } {
  let model = "deepseek-chat";
  let baseUrl = "https://api.deepseek.com";

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--model" && argv[i + 1]) model = argv[++i];
    else if (argv[i] === "--base-url" && argv[i + 1]) baseUrl = argv[++i];
  }
  return { model, baseUrl };
}

// ── Load POCKET.md ───────────────────────────────────────────────────

async function loadPocketMd(): Promise<string> {
  try {
    return await readFile(resolve("POCKET.md"), "utf-8");
  } catch {
    return "";
  }
}

// ── Build system prompt ──────────────────────────────────────────────

function buildSystemPrompt(pocketMd: string): string {
  const parts: string[] = [];
  if (pocketMd) parts.push(pocketMd);
  parts.push(
    "You are a coding assistant. You must use tools to gather information. Do not guess file contents or command outputs.",
  );
  return parts.join("\n\n");
}

// ── Slash commands ───────────────────────────────────────────────────

function handleSlashCommand(
  input: string,
  agent: Agent,
  config: LLMConfig,
): boolean {
  const parts = input.trim().split(/\s+/);
  const cmd = parts[0];

  if (cmd === "/exit") {
    process.exit(0);
  }

  if (cmd === "/clear") {
    agent.clearHistory();
    console.log("Conversation cleared.");
    return true;
  }

  if (cmd === "/help") {
    console.log(`Commands:
  /model <name> [--base-url <url>]  Switch LLM model
  /clear                            Clear conversation history
  /help                             Show this help
  /exit                             Exit`);
    return true;
  }

  if (cmd === "/model") {
    const newModel = parts[1];
    if (!newModel) {
      console.log(`Current model: ${config.model} (${config.baseUrl})`);
      return true;
    }
    config.model = newModel;
    const baseIdx = parts.indexOf("--base-url");
    if (baseIdx !== -1 && parts[baseIdx + 1]) {
      config.baseUrl = parts[baseIdx + 1];
    }
    agent.setConfig(config);
    console.log(`Switched to ${config.model} (${config.baseUrl})`);
    return true;
  }

  return false;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const { model, baseUrl } = parseArgs(process.argv);
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
  if (!apiKey) {
    printError("Set LLM_API_KEY or OPENAI_API_KEY environment variable");
    process.exit(1);
  }

  const config: LLMConfig = { model, baseUrl, apiKey };
  const pocketMd = await loadPocketMd();

  // Load MCP servers from pocket.json
  const mcp = new McpManager();
  const { tools: mcpTools, toolNames: mcpNames } = await mcp.loadFromConfig();

  const agent = new Agent(config, buildSystemPrompt(pocketMd), mcp);
  if (mcpTools.length > 0) {
    agent.addTools(mcpTools, mcpNames); // All MCP tools require confirmation
  }

  // Clean up MCP on exit
  process.on("exit", () => mcp.shutdownAll());
  process.on("SIGINT", () => { mcp.shutdownAll(); process.exit(0); });

  console.log(`Pocket Code — ${config.model} @ ${config.baseUrl}`);
  console.log('Type /help for commands, /exit to quit.\n');

  initReadline();

  while (true) {
    const input = await question("> ");
    const trimmed = input.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("/")) {
      if (!handleSlashCommand(trimmed, agent, config)) {
        printError(`Unknown command: ${trimmed.split(/\s+/)[0]}`);
      }
      continue;
    }

    await agent.run(trimmed);
    console.log();
  }
}

main();
