import chalk from "chalk";
import { createInterface, type Interface } from "node:readline";

// Shared readline — only one instance to avoid stdin conflicts
let rl: Interface;

export function initReadline(): Interface {
  rl = createInterface({ input: process.stdin, output: process.stdout });
  return rl;
}

export function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer));
  });
}

// ── Spinner ──────────────────────────────────────────────────────────

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinnerTimer: ReturnType<typeof setInterval> | null = null;

export function startSpinner(label: string) {
  let i = 0;
  process.stdout.write(chalk.cyan(`${FRAMES[0]} ${label}`));
  spinnerTimer = setInterval(() => {
    i = (i + 1) % FRAMES.length;
    process.stdout.write(`\r${chalk.cyan(`${FRAMES[i]} ${label}`)}`);
  }, 80);
}

export function stopSpinner() {
  if (spinnerTimer) {
    clearInterval(spinnerTimer);
    spinnerTimer = null;
    process.stdout.write("\r\x1b[K"); // clear the line
  }
}

export function printThinking(text: string) {
  console.log(chalk.gray(`[思考] ${text}`));
}

export function printToolCall(name: string, args: Record<string, unknown>) {
  console.log(chalk.blue(`[工具] ${name}(${JSON.stringify(args)})`));
}


export function printResult(text: string) {
  console.log(chalk.green(`[结果] ${text}`));
}

export function printError(text: string) {
  console.log(chalk.red(`[错误] ${text}`));
}

export function printAnswer(text: string) {
  console.log(chalk.white(`[回答] ${text}`));
}
