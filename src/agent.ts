import { chatCompletion, type LLMConfig, type Message, type ToolDef } from "./llm.js";
import { toolDefs, needsConfirmation, executeTool } from "./tools.js";
import { confirm } from "./permissions.js";
import { type McpManager } from "./mcp.js";
import {
  printThinking,
  printToolCall,
  printResult,
  printError,
  printAnswer,
  startSpinner,
  stopSpinner,
} from "./ui.js";

export class Agent {
  private config: LLMConfig;
  private messages: Message[] = [];
  private tools: ToolDef[] = [...toolDefs];
  private mcp?: McpManager;

  constructor(config: LLMConfig, systemPrompt: string, mcp?: McpManager) {
    this.config = config;
    this.mcp = mcp;
    this.messages.push({ role: "system", content: systemPrompt });
  }

  setConfig(config: LLMConfig) {
    this.config = config;
  }

  clearHistory() {
    const system = this.messages[0];
    this.messages = [system];
  }

  /** Register extra tools (e.g. from MCP) */
  addTools(defs: ToolDef[], confirmNames: string[]) {
    this.tools.push(...defs);
    for (const name of confirmNames) needsConfirmation.add(name);
  }

  /** Run one turn: user message → agentic loop → final answer */
  async run(userInput: string): Promise<void> {
    const checkpoint = this.messages.length;
    this.messages.push({ role: "user", content: userInput });

    // Agentic loop: keep going until LLM returns a text answer (no tool calls)
    while (true) {
      let reply: Message;
      try {
        startSpinner("思考中...");
        reply = await chatCompletion(this.config, this.messages, this.tools);
        stopSpinner();
      } catch (err) {
        stopSpinner();
        const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
        printError(msg);
        // Roll back all messages from this turn so user can retry
        this.messages.length = checkpoint;
        return;
      }

      // Show thinking (text content before/alongside tool calls)
      if (reply.content) {
        if (reply.tool_calls && reply.tool_calls.length > 0) {
          printThinking(reply.content);
        } else {
          printAnswer(reply.content);
        }
      }

      // No tool calls → final answer, done
      if (!reply.tool_calls || reply.tool_calls.length === 0) {
        this.messages.push(reply);
        return;
      }

      // Has tool calls → execute each one
      this.messages.push(reply);

      for (const tc of reply.tool_calls) {
        const name = tc.function.name;
        let args: Record<string, string>;
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          const errMsg = `Error: invalid JSON in tool arguments: ${tc.function.arguments}`;
          printError(errMsg);
          this.messages.push({ role: "tool", tool_call_id: tc.id, content: errMsg });
          continue;
        }

        printToolCall(name, args);

        // Permission check for dangerous tools
        if (needsConfirmation.has(name)) {
          const allowed = await confirm(name, args);
          if (!allowed) {
            const denied = "Error: user denied this operation";
            printError(denied);
            this.messages.push({ role: "tool", tool_call_id: tc.id, content: denied });
            continue;
          }
        }

        // Execute tool (built-in or MCP)
        try {
          const result = this.mcp?.isMcpTool(name)
            ? await this.mcp.callTool(name, args)
            : await executeTool(name, args);
          const display = result.length > 500 ? result.slice(0, 500) + "..." : result;
          printResult(display);
          this.messages.push({ role: "tool", tool_call_id: tc.id, content: result });
        } catch (err) {
          const errMsg = `Error: ${String(err)}`;
          printError(errMsg);
          this.messages.push({ role: "tool", tool_call_id: tc.id, content: errMsg });
        }
      }
      // Loop continues — LLM will see tool results and decide next step
    }
  }
}
