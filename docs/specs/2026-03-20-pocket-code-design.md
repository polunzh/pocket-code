# Pocket Code - Design Spec

## Overview

Pocket Code is an educational agentic coding CLI that demonstrates AI agent principles. Built for teaching and presentation — transparent, minimal, and easy to understand.

**Target audience:** People learning how agentic coding tools (Claude Code, Codex CLI) work under the hood.

## Goals

- Demonstrate the agentic loop (gather → act → verify) in a transparent, visual way
- Total source code: 600-900 lines across 7 files
- Every step of agent reasoning visible in the terminal with color-coded output

## Non-Goals

- Auto memory / MEMORY.md
- Subagents
- Context compression / context window overflow handling
- Checkpoint / file rollback
- Sandbox isolation
- Full MCP protocol (only minimal stdio support)
- Streaming output (use non-streaming for simplicity)

## Tech Stack

- **Language:** TypeScript / Node.js
- **LLM API:** OpenAI-compatible format (works with DeepSeek, Qwen, Ollama, etc.)
- **Terminal:** Colored output via chalk or similar

## Architecture

```
pocket-code/
├── src/
│   ├── index.ts          # Entry: parse args, start REPL
│   ├── agent.ts          # Core: agentic loop
│   ├── tools.ts          # Tool definitions and execution
│   ├── llm.ts            # LLM call wrapper (OpenAI-compatible)
│   ├── ui.ts             # Colored terminal output
│   ├── permissions.ts    # User confirmation for dangerous ops
│   └── mcp.ts            # Minimal MCP client (stdio transport)
├── pocket.json           # MCP server config (optional)
├── POCKET.md             # Project instructions (optional)
├── package.json
└── tsconfig.json
```

### Core Flow

```
User input → agent.ts builds messages → llm.ts calls API
    ↓
LLM returns tool_call?
    ├── Yes → permissions.ts confirm → tools.ts execute → feed result back → continue loop
    └── No  → ui.ts print final answer → wait for next input
```

## Tool System

7 built-in tools:

| Tool | Purpose | Needs Confirmation |
|------|---------|-------------------|
| `read_file` | Read file contents | No |
| `write_file` | Create/overwrite file | Yes |
| `edit_file` | Partial edit (old_string → new_string) | Yes |
| `list_dir` | List directory contents | No |
| `search_files` | Grep file contents | No |
| `run_command` | Execute shell command | Yes |
| `ask_user` | Ask user for more info | No |

**Permission rule:** Read-only operations execute directly. Write and command operations require user confirmation.

### Tool Parameter Schemas

```
read_file(path: string) → string (max 2000 lines, truncated with "[truncated, showing first 2000 of N lines]")
write_file(path: string, content: string) → "OK"
edit_file(path: string, old_string: string, new_string: string) → "OK" | error
  - old_string is literal match (not regex)
  - Fails if old_string not found or matches multiple locations
list_dir(path?: string) → string (defaults to cwd)
search_files(pattern: string, path?: string) → string (grep -rn, max 100 matches, truncated with "[truncated, showing first 100 of N matches]")
run_command(command: string) → { exitCode, output, timedOut } (shell execution, stdout+stderr merged, 30s timeout, output max 2000 lines)
ask_user(question: string) → string (user's response)
```

## MCP Support (Minimal)

- Only stdio transport
- Read `pocket.json` at startup to discover MCP servers
- Spawn server process, perform MCP lifecycle:
  1. Send `initialize` request, receive server capabilities
  2. Send `initialized` notification
  3. Call `tools/list` to discover available tools
  4. Register MCP tools alongside built-in tools
  5. On tool call: send `tools/call` request, return result
  6. On exit: close transport, kill child process
- **MCP tool permissions:** All MCP tools require user confirmation (no way to classify them as read-only)

```json
{
  "mcpServers": {
    "weather": {
      "command": "node",
      "args": ["./my-weather-server.js"]
    }
  }
}
```

## Terminal Output Style

Color-coded output showing every agent step:

- **Gray** — `[思考]` LLM reasoning (the text content returned before tool_call, not a special API field)
- **Blue** — `[工具]` Tool call with parameters
- **Yellow** — `[确认]` Permission confirmation prompt
- **Green** — `[结果]` Tool execution result
- **Red** — `[错误]` Errors
- **White** — `[回答]` Final answer to user

## LLM Integration

- Unified OpenAI-compatible API format
- Startup: `pocket-code --model deepseek-chat --base-url https://api.deepseek.com`
- Runtime switch: `/model <name> [--base-url <url>]`
- API key via `LLM_API_KEY` environment variable (falls back to `OPENAI_API_KEY`)
- `/model` switch only affects subsequent turns, does not replay history

### POCKET.md Loading

- Search cwd only (no parent directory traversal)
- UTF-8 encoding
- If missing, silently skip

### System Prompt Construction

```
[POCKET.md contents (if exists)]
+
[Tool definitions (auto-injected)]
+
[Fixed agent instruction: You are a coding assistant. You must use tools to gather information. Do not guess file contents or command outputs.]
```

## Slash Commands

| Command | Action |
|---------|--------|
| `/model <name> [--base-url <url>]` | Switch model |
| `/help` | Show help |
| `/clear` | Clear conversation history |
| `/exit` | Exit |

## Error Handling

Simple strategy — surface errors to LLM and let it decide:

- **API errors (401/429/500):** Print red error message to terminal. On 429 (rate limit), wait and retry once. On other errors, abort the current turn and let user retry.
- **Malformed tool calls (wrong name, bad params):** Return error message as tool result, let LLM self-correct in the next loop iteration.
- **Tool execution failure (file not found, non-zero exit):** Return error output as tool result, let LLM decide next step.
- **MCP server crash:** Print warning, remove that server's tools, continue with remaining tools.

## Demo Scenarios

1. **Bug fix:** Give agent a buggy Python file, watch it read → diagnose → edit → verify
2. **New feature:** Ask agent to create a small utility from scratch
