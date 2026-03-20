# Pocket Code

一个教学用的 Agent 编程 CLI，展示 [Claude Code](https://claude.ai/code) 和 [Codex CLI](https://github.com/openai/codex) 这类工具的内部工作原理。

约 900 行 TypeScript，没有魔法，没有框架——只有最核心的 Agent 循环。

[English](README.md)

## 工作原理

```
用户输入 → LLM 决定调用哪些工具 → 执行工具 → 将结果返回给 LLM → 重复
```

Agent 在一个循环中运行：把你的消息发给 LLM，LLM 决定调用哪些工具（读文件、执行命令等），执行结果被送回，循环持续直到 LLM 有足够信息来回答。

终端中每一步都用彩色标记清晰可见：

- 灰色 `[思考]` — LLM 的推理过程
- 蓝色 `[工具]` — 工具调用及参数
- 黄色 `[确认]` — 权限确认提示（y/n）
- 绿色 `[结果]` — 工具执行结果
- 红色 `[错误]` — 错误信息
- 白色 `[回答]` — 最终回答

## 快速开始

```bash
npm install
npm run build

export LLM_API_KEY=你的API密钥
node dist/index.js
```

默认使用 `deepseek-chat`。切换其他服务商：

```bash
node dist/index.js --model gpt-4o --base-url https://api.openai.com
```

支持任何 OpenAI 兼容 API：DeepSeek、Qwen、Ollama 等。

## 内置工具

| 工具 | 用途 | 需要确认 |
|------|------|---------|
| `read_file` | 读取文件内容 | 否 |
| `write_file` | 创建/覆盖文件 | 是 |
| `edit_file` | 局部字符串替换 | 是 |
| `list_dir` | 列出目录内容 | 否 |
| `search_files` | 搜索文件内容 | 否 |
| `run_command` | 执行 shell 命令 | 是 |
| `ask_user` | 向用户提问 | 否 |

## 斜杠命令

| 命令 | 功能 |
|------|------|
| `/model <名称> [--base-url <地址>]` | 切换 LLM 模型 |
| `/clear` | 清空对话历史 |
| `/help` | 显示帮助 |
| `/exit` | 退出 |

## MCP 支持

最小化的 [MCP](https://modelcontextprotocol.io) 客户端（仅支持 stdio 传输）。在项目根目录添加 `pocket.json`：

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

## 项目结构

```
src/
├── index.ts          # 入口、REPL、斜杠命令
├── agent.ts          # 核心 Agent 循环
├── tools.ts          # 7 个内置工具
├── llm.ts            # OpenAI 兼容 API 封装
├── ui.ts             # 彩色终端输出 + 等待动画
├── permissions.ts    # 写操作的用户确认
└── mcp.ts            # 最小化 MCP 客户端
```

## 演讲稿

`slides/` 目录包含一份 reveal.js 演讲稿，讲解整个架构。用浏览器打开 `slides/index.html` 即可。

## 自定义

在项目根目录添加 `POCKET.md` 文件，给 Agent 提供项目专属指令（类似 Claude Code 的 CLAUDE.md），会自动添加到系统提示词中。
