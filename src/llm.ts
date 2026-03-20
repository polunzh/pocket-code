// OpenAI-compatible LLM API wrapper (non-streaming)

import https from "node:https";
import http from "node:http";

export interface LLMConfig {
  model: string;
  baseUrl: string;
  apiKey: string;
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface ChatResponse {
  choices: Array<{
    message: {
      role: "assistant";
      content?: string | null;
      tool_calls?: ToolCall[];
    };
  }>;
}

function httpRequest(url: string, apiKey: string, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? https : http;

    const req = mod.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          Connection: "close",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          if (res.statusCode === 429) {
            reject({ status: 429, body });
            return;
          }
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            reject(new Error(`LLM API error ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          resolve(body);
        });
        res.on("error", reject);
      },
    );

    req.on("error", reject);
    req.setTimeout(120_000, () => {
      req.destroy(new Error("LLM request timeout (120s)"));
    });
    req.write(payload);
    req.end();
  });
}

export async function chatCompletion(
  config: LLMConfig,
  messages: Message[],
  tools: ToolDef[],
): Promise<Message> {
  const url = `${config.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
  };
  if (tools.length > 0) {
    body.tools = tools;
  }

  const payload = JSON.stringify(body);

  const MAX_RETRIES = 2;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const text = await httpRequest(url, config.apiKey, payload);

      let data: ChatResponse;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`LLM returned invalid JSON: ${text.slice(0, 200)}`);
      }

      if (!data.choices?.[0]?.message) {
        throw new Error(`LLM returned unexpected format: ${text.slice(0, 200)}`);
      }

      return data.choices[0].message;
    } catch (err: unknown) {
      const isRateLimit = err && typeof err === "object" && "status" in err && err.status === 429;

      if (isRateLimit && attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}
