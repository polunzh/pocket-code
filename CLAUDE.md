# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Pocket Code — an educational agentic coding CLI (TypeScript/Node.js) that demonstrates how tools like Claude Code and Codex CLI work. Target: 600-900 lines across 7 source files. Prioritize minimal code over features.

## Architecture

Agentic loop: user input → LLM decides tool calls → execute tools → feed results back → repeat until LLM returns text answer.

7 source files in `src/`: `index.ts` (entry/REPL), `agent.ts` (agentic loop), `tools.ts` (7 built-in tools), `llm.ts` (OpenAI-compatible API wrapper), `ui.ts` (colored terminal output), `permissions.ts` (user confirmation), `mcp.ts` (minimal MCP client).

Design spec: `docs/specs/2026-03-20-pocket-code-design.md`

## Key Constraints

- Non-streaming LLM calls only
- All LLM APIs must be OpenAI-compatible format
- Tool errors go back to LLM as tool results (let LLM self-correct)
- MCP: stdio transport only, minimal lifecycle (initialize → tools/list → tools/call → shutdown)
- All MCP tools and write/command built-in tools require user confirmation before execution
