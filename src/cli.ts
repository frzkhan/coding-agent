import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import chalk from "chalk";
import { Command } from "commander";
import ora from "ora";
import { buildFileTree } from "./agent/fileTree.js";
import { runAgentLoop } from "./agent/loop.js";
import { buildSystemPrompt } from "./agent/prompts.js";
import type { AgentResult, AgentTokenUsage } from "./agent/state.js";
import { loadConfig } from "./config.js";
import { ConfigError, LlmError } from "./errors.js";
import type { ChatMessage, LlmClient } from "./llm/client.js";
import { OllamaClient } from "./llm/providers/ollama.js";
import { OpenAiClient } from "./llm/providers/openai.js";
import { GlobTool, ReadFileTool, StrReplaceTool, WriteFileTool } from "./tools/fsTools.js";
import { SearchTool } from "./tools/searchTool.js";
import { ShellTool } from "./tools/shellTool.js";
import { TsLanguageServerSession } from "./tools/tsLspSession.js";
import {
  TsDefinitionTool,
  TsDiagnosticsTool,
  TsHoverTool,
  TsReferencesTool,
  TsWorkspaceSymbolsTool
} from "./tools/tsLspTools.js";
import { ToolRegistry } from "./tools/types.js";

type SessionState = {
  messages: ChatMessage[];
  maxSteps: number;
  contextTokenLimit: number;
  dryRun: boolean;
  model: string;
  systemPrompt: string;
  llmClient: LlmClient;
  toolRegistry: ToolRegistry;
};

type RuntimeOptions = {
  dryRun: boolean;
  config: ReturnType<typeof loadConfig>;
};

type SessionCommand =
  | { type: "exit" }
  | { type: "help" }
  | { type: "reset" }
  | { type: "tools" }
  | { type: "config" }
  | { type: "max"; value: number }
  | { type: "dryrun"; value: boolean };

function formatTokenUsage(usage: AgentTokenUsage): string {
  return `tokens: ${usage.totalTokens} total (${usage.inputTokens} in, ${usage.outputTokens} out, ${usage.source})`;
}

function truncateStatus(value: string, maxLength = 80): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function terminalColumns(): number {
  return Math.max(40, process.stdout.columns || 100);
}

function spinnerStatus(value: string): string {
  return truncateStatus(value, Math.max(30, terminalColumns() - 25));
}

function wrapLogLine(value: string, width = terminalColumns()): string {
  const words = value.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (`${current} ${word}`.length > width) {
      lines.push(current);
      current = word;
      continue;
    }
    current = `${current} ${word}`;
  }

  if (current) lines.push(current);
  return lines.join("\n");
}

function formatPersistedStep(step: number, maxSteps: number, info: string): string {
  const prefix = `Step ${step}/${maxSteps}: `;
  const indent = " ".repeat(prefix.length);
  return wrapLogLine(`${prefix}${info}`).split("\n").map((line, index) => (index === 0 ? line : `${indent}${line}`)).join("\n");
}

function shouldPersistStepInfo(info: string): boolean {
  return (
    info.startsWith("Thought:") ||
    info.startsWith("Calling tool:") ||
    info.startsWith("Tool succeeded:") ||
    info.startsWith("Tool failed:") ||
    info.startsWith("Tool unavailable:") ||
    info.startsWith("Auto-verified") ||
    info.startsWith("Rejected final answer:") ||
    info.startsWith("Model output invalid:") ||
    info.startsWith("Using raw model answer") ||
    info.startsWith("Model produced final answer") ||
    info.startsWith("Compacted context")
  );
}

export const SLASH_COMMANDS = [
  { command: "/exit", description: "End session" },
  { command: "/quit", description: "End session" },
  { command: "/help", description: "Show commands" },
  { command: "/reset", description: "Clear conversation history" },
  { command: "/tools", description: "List enabled tools" },
  { command: "/config", description: "Show current session config" },
  { command: "/max N", description: "Set max steps per turn" },
  { command: "/dryrun on|off", description: "Toggle write/shell tools" }
];

export function parseSessionCommand(input: string): SessionCommand | null {
  const text = input.trim();
  if (!text.startsWith("/")) return null;

  if (text === "/exit" || text === "/quit") return { type: "exit" };
  if (text === "/help") return { type: "help" };
  if (text === "/reset") return { type: "reset" };
  if (text === "/tools") return { type: "tools" };
  if (text === "/config") return { type: "config" };

  const maxMatch = text.match(/^\/max\s+(\d+)$/);
  if (maxMatch) return { type: "max", value: Number(maxMatch[1]) };

  const dryRunMatch = text.match(/^\/dryrun\s+(on|off)$/);
  if (dryRunMatch) return { type: "dryrun", value: dryRunMatch[1] === "on" };

  return null;
}

function getSlashCommandSuggestions(input: string): string[] {
  const text = input.trim();
  if (!text.startsWith("/")) return [];

  const partial = text.slice(1).toLowerCase();
  return SLASH_COMMANDS.filter(cmd => cmd.command.toLowerCase().includes(partial)).map(cmd => cmd.command);
}

function createRuntime(options: RuntimeOptions) {
  const llmClient: LlmClient =
    options.config.provider === "openai"
      ? new OpenAiClient({
          model: options.config.model,
          temperature: options.config.temperature
        })
      : new OllamaClient({
          model: options.config.model,
          temperature: options.config.temperature,
          baseUrl: options.config.ollamaBaseUrl
        });

  const toolRegistry = new ToolRegistry();
  const workspaceRoot = process.cwd();
  toolRegistry.register(new ReadFileTool(workspaceRoot));
  toolRegistry.register(new GlobTool(workspaceRoot));
  toolRegistry.register(new SearchTool(workspaceRoot));

  const tsLsp = new TsLanguageServerSession(workspaceRoot);
  toolRegistry.register(new TsWorkspaceSymbolsTool(tsLsp));
  toolRegistry.register(new TsDefinitionTool(tsLsp));
  toolRegistry.register(new TsReferencesTool(tsLsp));
  toolRegistry.register(new TsHoverTool(tsLsp));
  toolRegistry.register(new TsDiagnosticsTool(tsLsp));

  if (!options.dryRun) {
    toolRegistry.register(new WriteFileTool(workspaceRoot));
    toolRegistry.register(new StrReplaceTool(workspaceRoot));
    toolRegistry.register(new ShellTool(workspaceRoot, options.config.shellAllowlist, options.config.shellTimeoutMs));
  }

  const systemPrompt = buildSystemPrompt(toolRegistry, workspaceRoot, buildFileTree(workspaceRoot));
  return { llmClient, toolRegistry, systemPrompt };
}

async function runSingleTurn(
  session: SessionState,
  task: string,
  useInteractiveUi: boolean,
  onStepOverride?: (step: number, info: string) => void
): Promise<AgentResult> {
  const spinner = useInteractiveUi ? ora({ text: "Starting agent..." }).start() : null;

  const streamedCharsByStep = new Map<number, number>();
  const result = await runAgentLoop({
    llmClient: session.llmClient,
    toolRegistry: session.toolRegistry,
    maxSteps: session.maxSteps,
    contextTokenLimit: session.contextTokenLimit,
    systemPrompt: session.systemPrompt,
    task,
    messages: session.messages,
    onStep: (step, info) => {
      if (onStepOverride) {
        onStepOverride(step, info);
        return;
      }

      if (!useInteractiveUi) {
        console.log(`[step ${step}] ${info}`);
        return;
      }

      if (info.startsWith("Calling model")) {
        spinner?.start();
        spinner!.text = spinnerStatus(`Step ${step}/${session.maxSteps}: thinking (${info.replace("Calling model with ", "")})`);
        return;
      }

      if (shouldPersistStepInfo(info)) {
        spinner?.stop();
        console.log(`${chalk.dim("•")} ${formatPersistedStep(step, session.maxSteps, info)}`);
      }

      spinner?.start();
      spinner!.text = spinnerStatus(`Step ${step}/${session.maxSteps}: ${info}`);
    },
    onModelChunk: (step, chunk) => {
      const nextChars = (streamedCharsByStep.get(step) ?? 0) + chunk.length;
      streamedCharsByStep.set(step, nextChars);
      if (!useInteractiveUi) {
        if (nextChars === chunk.length || nextChars % 120 < chunk.length) {
          console.log(`[step ${step}] received ${nextChars} streamed chars`);
        }
        return;
      }

      spinner?.start();
      spinner!.text = spinnerStatus(`Step ${step}/${session.maxSteps}: receiving model stream (${nextChars} chars)`);
    }
  });

  if (result.stopReason === "done") {
    spinner?.succeed(chalk.green(`Completed in ${result.steps} step(s) | ${formatTokenUsage(result.tokenUsage)}`));
  } else {
    spinner?.warn(chalk.yellow(`Stopped: ${result.stopReason} after ${result.steps} step(s) | ${formatTokenUsage(result.tokenUsage)}`));
  }

  return result;
}

function printSessionHelp(): void {
  console.log(chalk.cyan("\nSession commands"));
  console.log(chalk.dim("/help      Show commands"));
  console.log(chalk.dim("/exit      End session"));
  console.log(chalk.dim("/reset     Clear conversation history"));
  console.log(chalk.dim("/max N     Set max steps per turn"));
  console.log(chalk.dim("/dryrun on|off  Toggle write/shell tools"));
  console.log(chalk.dim("/tools     List enabled tools"));
  console.log(chalk.dim("/config    Show current session config"));
}

function printSessionConfig(session: SessionState): void {
  console.log(chalk.cyan("\nSession config"));
  console.log(chalk.dim(`maxSteps: ${session.maxSteps}`));
  console.log(chalk.dim(`contextTokenLimit: ${session.contextTokenLimit}`));
  console.log(chalk.dim(`dryRun: ${session.dryRun}`));
  console.log(chalk.dim(`tools: ${session.toolRegistry.listNames().join(", ")}`));
}

export function resolveCliModes(params: {
  rawTask: string;
  interactiveOption: boolean;
  chatOption: boolean;
  canUseTty: boolean;
}): { shouldPromptInteractively: boolean; shouldUseChat: boolean } {
  const shouldPromptInteractively =
    (params.interactiveOption || !params.rawTask) && params.canUseTty;
  const shouldUseChat = params.chatOption || (!params.rawTask && params.canUseTty);
  return { shouldPromptInteractively, shouldUseChat };
}

export function formatChatHeader(state: Pick<SessionState, "model" | "dryRun" | "maxSteps" | "contextTokenLimit">): string {
  return [
    chalk.cyan("coding-agent"),
    chalk.dim(`model: ${state.model}`),
    chalk.dim(`dry-run: ${state.dryRun ? "on" : "off"}`),
    chalk.dim(`max steps: ${state.maxSteps}`),
    chalk.dim(`context: ${state.contextTokenLimit} tokens`)
  ].join("  ");
}

async function runChatSession(state: SessionState): Promise<number> {
  const rl = createInterface({
    input,
    output,
    completer(line: string): [string[], string] {
      const completions = getSlashCommandSuggestions(line);
      return [completions, line];
    }
  });

  console.log(formatChatHeader(state));
  console.log(
    chalk.dim(
      "Type a request. Session: /max N  /dryrun on|off  /config  /help  /reset  /tools  /exit\n"
    )
  );

  while (true) {
    const ac = new AbortController();
    const onSigInt = (): void => {
      ac.abort();
    };
    process.once("SIGINT", onSigInt);

    let userInput: string;
    try {
      userInput = (await rl.question(chalk.green("> "), { signal: ac.signal })).trim();
    } catch (err) {
      if (ac.signal.aborted) {
        rl.close();
        console.log(chalk.dim("\nInterrupted."));
        return 130;
      }
      throw err;
    } finally {
      process.removeListener("SIGINT", onSigInt);
    }

    if (!userInput) continue;

    const command = parseSessionCommand(userInput);
    if (command) {
      if (command.type === "exit") {
        rl.close();
        console.log(chalk.cyan("Session ended."));
        return 0;
      }
      if (command.type === "help") {
        printSessionHelp();
        continue;
      }
      if (command.type === "reset") {
        state.messages = [{ role: "system", content: state.systemPrompt }];
        console.log(chalk.yellow("Conversation history reset."));
        continue;
      }
      if (command.type === "tools") {
        console.log(chalk.cyan(`Tools: ${state.toolRegistry.listNames().join(", ")}`));
        continue;
      }
      if (command.type === "config") {
        printSessionConfig(state);
        continue;
      }
      if (command.type === "max") {
        state.maxSteps = command.value;
        console.log(chalk.green(`maxSteps set to ${state.maxSteps}.`));
        continue;
      }
      if (command.type === "dryrun") {
        const config = loadConfig();
        const runtime = createRuntime({ dryRun: command.value, config });
        state.dryRun = command.value;
        state.model = config.model;
        state.contextTokenLimit = config.contextTokenLimit;
        state.llmClient = runtime.llmClient;
        state.toolRegistry = runtime.toolRegistry;
        state.systemPrompt = runtime.systemPrompt;
        state.messages = [{ role: "system", content: state.systemPrompt }];
        console.log(
          chalk.green(
            `dryRun ${state.dryRun ? "enabled" : "disabled"}. Session context reset for tool safety.`
          )
        );
        continue;
      }
    }

    const result = await runSingleTurn(state, userInput, true);
    state.messages = result.messages;
    console.log(chalk.magenta("\nagent"));
    console.log(result.finalResponse);
    console.log(
      chalk.dim(
        `\nStop reason: ${result.stopReason} in ${result.steps} step(s) | ${formatTokenUsage(
          result.tokenUsage
        )} | dry-run: ${state.dryRun}\n`
      )
    );
  }
}

export async function runCli(argv: string[]): Promise<number> {
  const program = new Command();
  program
    .name("coding-agent")
    .description("Simple CLI AI coding agent")
    .argument("[task...]", "Task for the agent")
    .option("--max-steps <number>", "Override max steps", (value) => Number(value))
    .option("--dry-run", "Skip writeFile and shell tool execution")
    .option("--interactive", "Always use interactive prompts")
    .option("--chat", "Start persistent chat session")
    .allowUnknownOption(false);

  program.parse(argv);
  const rawTask = (program.args as string[]).join(" ").trim();
  const opts = program.opts() as { maxSteps?: number; dryRun?: boolean; interactive?: boolean; chat?: boolean };

  const dryRun = Boolean(opts.dryRun);
  const canUseTty = process.stdin.isTTY && process.stdout.isTTY;
  const { shouldPromptInteractively, shouldUseChat } = resolveCliModes({
    rawTask,
    interactiveOption: Boolean(opts.interactive),
    chatOption: Boolean(opts.chat),
    canUseTty
  });

  if (!rawTask && !shouldPromptInteractively && !shouldUseChat) {
    console.error("Task is required. Pass one or run in a TTY for interactive mode.");
    return 1;
  }

  try {
    const config = loadConfig();
    const maxSteps = Number.isFinite(opts.maxSteps) ? (opts.maxSteps as number) : config.maxSteps;
    const runtime = createRuntime({ dryRun, config });
    const state: SessionState = {
      messages: [{ role: "system", content: runtime.systemPrompt }],
      maxSteps,
      contextTokenLimit: config.contextTokenLimit,
      dryRun,
      model: config.model,
      systemPrompt: runtime.systemPrompt,
      llmClient: runtime.llmClient,
      toolRegistry: runtime.toolRegistry
    };

    if (shouldUseChat) {
      return runChatSession(state);
    }

    if (!rawTask) {
      console.error("Task is required.");
      return 1;
    }

    const result = await runSingleTurn(state, rawTask, shouldPromptInteractively);
    state.messages = result.messages;
    console.log(chalk.bold("\nResult"));
    console.log(result.finalResponse);
    console.log(
      chalk.dim(
        `\nStop reason: ${result.stopReason} in ${result.steps} step(s) | ${formatTokenUsage(
          result.tokenUsage
        )} | dry-run: ${dryRun}`
      )
    );
    return result.stopReason === "done" ? 0 : 2;
  } catch (error) {
    if (error instanceof ConfigError || error instanceof LlmError) {
      console.error(error.message);
      return 1;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Unexpected error: ${message}`);
    return 1;
  }
}
