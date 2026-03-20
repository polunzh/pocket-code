import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { exec } from "node:child_process";
import { resolve } from "node:path";
import type { ToolDef } from "./llm.js";
import { question } from "./ui.js";

// ── Tool definitions (sent to LLM) ──────────────────────────────────

export const toolDefs: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read file contents (max 2000 lines)",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or overwrite a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Edit a file by replacing old_string with new_string (literal match, must be unique)",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List directory contents",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search file contents with grep (max 100 matches)",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Execute a shell command (30s timeout)",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ask_user",
      description: "Ask the user a question and wait for their response",
      parameters: {
        type: "object",
        properties: { question: { type: "string" } },
        required: ["question"],
      },
    },
  },
];

// ── Which tools need user confirmation ───────────────────────────────

export const needsConfirmation = new Set([
  "write_file",
  "edit_file",
  "run_command",
]);

// ── Tool execution ───────────────────────────────────────────────────

export async function executeTool(
  name: string,
  args: Record<string, string>,
): Promise<string> {
  switch (name) {
    case "read_file":
      return readFileTool(args.path);
    case "write_file":
      return writeFileTool(args.path, args.content);
    case "edit_file":
      return editFileTool(args.path, args.old_string, args.new_string);
    case "list_dir":
      return listDirTool(args.path);
    case "search_files":
      return searchFilesTool(args.pattern, args.path);
    case "run_command":
      return runCommandTool(args.command);
    case "ask_user":
      return askUserTool(args.question);
    default:
      return `Error: unknown tool "${name}"`;
  }
}

// ── Individual tool implementations ──────────────────────────────────

const MAX_LINES = 2000;
const MAX_MATCHES = 100;

async function readFileTool(path: string): Promise<string> {
  const content = await readFile(resolve(path), "utf-8");
  const lines = content.split("\n");
  if (lines.length <= MAX_LINES) return content;
  return (
    lines.slice(0, MAX_LINES).join("\n") +
    `\n[truncated, showing first ${MAX_LINES} of ${lines.length} lines]`
  );
}

async function writeFileTool(path: string, content: string): Promise<string> {
  await writeFile(resolve(path), content, "utf-8");
  return "OK";
}

async function editFileTool(
  path: string,
  oldStr: string,
  newStr: string,
): Promise<string> {
  const content = await readFile(resolve(path), "utf-8");
  const count = content.split(oldStr).length - 1;
  if (count === 0) return "Error: old_string not found in file";
  if (count > 1) return "Error: old_string matches multiple locations";
  return writeFile(resolve(path), content.replace(oldStr, newStr), "utf-8").then(
    () => "OK",
  );
}

async function listDirTool(path?: string): Promise<string> {
  const dir = resolve(path || ".");
  const entries = await readdir(dir);
  const result: string[] = [];
  for (const name of entries) {
    const s = await stat(resolve(dir, name));
    result.push(s.isDirectory() ? `${name}/` : name);
  }
  return result.join("\n");
}

function execAsync(
  command: string,
  options: { cwd?: string; timeout?: number },
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = exec(
      command,
      { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, ...options },
      (error, stdout, stderr) => {
        if (error) {
          resolve({
            stdout: stdout || "",
            stderr: stderr || "",
            exitCode: error.code ?? 1,
            timedOut: error.killed === true,
          });
        } else {
          resolve({ stdout, stderr, exitCode: 0, timedOut: false });
        }
      },
    );
    // Detach child stdin so it doesn't inherit parent's
    child.stdin?.end();
  });
}

async function searchFilesTool(
  pattern: string,
  path?: string,
): Promise<string> {
  const dir = resolve(path || ".");
  const { stdout, exitCode } = await execAsync(
    `grep -rn "${pattern.replace(/"/g, '\\"')}" .`,
    { cwd: dir, timeout: 30_000 },
  );
  if (exitCode === 1) return "No matches found";
  const lines = stdout.split("\n").filter(Boolean);
  if (lines.length <= MAX_MATCHES) return lines.join("\n");
  return (
    lines.slice(0, MAX_MATCHES).join("\n") +
    `\n[truncated, showing first ${MAX_MATCHES} of ${lines.length} matches]`
  );
}

async function runCommandTool(command: string): Promise<string> {
  const { stdout, stderr, exitCode, timedOut } = await execAsync(command, { timeout: 30_000 });
  const output = stdout + stderr;
  return truncateOutput(JSON.stringify({ exitCode, output, timedOut }));
}

function truncateOutput(json: string): string {
  const obj = JSON.parse(json) as { output: string; exitCode: number; timedOut: boolean };
  const lines = obj.output.split("\n");
  if (lines.length > MAX_LINES) {
    obj.output =
      lines.slice(0, MAX_LINES).join("\n") +
      `\n[truncated, showing first ${MAX_LINES} of ${lines.length} lines]`;
  }
  return JSON.stringify(obj);
}

async function askUserTool(q: string): Promise<string> {
  return question(`${q}\n> `);
}
