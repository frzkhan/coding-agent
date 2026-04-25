import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Tool, ToolResult } from "./types.js";

const execAsync = promisify(exec);

type ExecError = Error & {
  stdout?: string | Buffer;
  stderr?: string | Buffer;
};

function outputPart(value: string | Buffer | undefined): string {
  return Buffer.isBuffer(value) ? value.toString("utf8") : value ?? "";
}

export class ShellTool implements Tool {
  readonly name = "shell";
  readonly parameters = '{ "command": "allowed shell command" }';
  readonly description =
    "Run a terminal command in the workspace (same idea as a generic run_terminal). Use this for verification and tasks the model infers from the repo: e.g. npm test, npx tsc, pytest, ruff, go test, cargo test. The command must match the allowlist prefix. Prefer scripts in package.json/pyproject.toml or instructions in CLAUDE.md or AGENTS.md when they exist.";

  constructor(
    private readonly workspaceRoot: string,
    private readonly allowlist: string[],
    private readonly timeoutMs: number
  ) {}

  private isAllowed(command: string): boolean {
    return this.allowlist.some((allowed) => command.startsWith(allowed));
  }

  private referencesIgnoredPath(command: string): boolean {
    return /(^|[\s/])(?:node_modules|dist)(?:[\s/]|$)/.test(command) || /(^|\s)\.env(?:\s|$)/.test(command);
  }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const command = String(args.command ?? "").trim();
    if (!command) {
      return { ok: false, output: `Missing command. Required args: ${this.parameters}` };
    }
    if (!this.isAllowed(command)) {
      return { ok: false, output: `Blocked command by allowlist: ${command}` };
    }
    if (this.referencesIgnoredPath(command)) {
      return { ok: false, output: "Blocked command because it references an ignored path." };
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.workspaceRoot,
        timeout: this.timeoutMs,
        maxBuffer: 64 * 1024
      });
      const output = [stdout, stderr].filter(Boolean).join("\n").trim();
      return { ok: true, output: output.slice(0, 3000) };
    } catch (error) {
      const execError = error as ExecError;
      const message = error instanceof Error ? error.message : String(error);
      const stdout = outputPart(execError.stdout).trim();
      const stderr = outputPart(execError.stderr).trim();
      const details = [stdout && `stdout:\n${stdout}`, stderr && `stderr:\n${stderr}`].filter(Boolean).join("\n");
      const output = [`Shell command failed: ${message}`, details].filter(Boolean).join("\n");
      return { ok: false, output: output.slice(0, 3000) };
    }
  }
}
