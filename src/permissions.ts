import chalk from "chalk";
import { question } from "./ui.js";

function summarize(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case "run_command":
      return `${toolName}: ${args.command}`;
    case "write_file":
      return `${toolName}: ${args.path} (${String(args.content).length} chars)`;
    case "edit_file":
      return `${toolName}: ${args.path} (replace ${String(args.old_string).length} chars)`;
    default:
      return `${toolName}: ${JSON.stringify(args).slice(0, 100)}`;
  }
}

export async function confirm(toolName: string, args: Record<string, unknown>): Promise<boolean> {
  const answer = await question(chalk.yellow(`[确认] ${summarize(toolName, args)} (y/n) `));
  return answer.trim().toLowerCase() === "y";
}
