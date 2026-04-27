import { exec } from "node:child_process";
import { promisify } from "node:util";
const execAsync = promisify(exec);
function outputPart(value) {
    return Buffer.isBuffer(value) ? value.toString("utf8") : value ?? "";
}
export class ShellTool {
    workspaceRoot;
    allowlist;
    timeoutMs;
    name = "shell";
    parameters = '{ "command": "allowed shell command" }';
    description = "Run a terminal command in the workspace (same idea as a generic run_terminal). Use this for verification and tasks the model infers from the repo: e.g. npm test, npx tsc, pytest, ruff, go test, cargo test. The command must match the allowlist prefix. Prefer scripts in package.json/pyproject.toml or instructions in CLAUDE.md or AGENTS.md when they exist.";
    constructor(workspaceRoot, allowlist, timeoutMs) {
        this.workspaceRoot = workspaceRoot;
        this.allowlist = allowlist;
        this.timeoutMs = timeoutMs;
    }
    isAllowed(command) {
        return this.allowlist.some((allowed) => command.startsWith(allowed));
    }
    referencesIgnoredPath(command) {
        return /(^|[\s/])(?:node_modules|dist)(?:[\s/]|$)/.test(command) || /(^|\s)\.env(?:\s|$)/.test(command);
    }
    async run(args) {
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
        }
        catch (error) {
            const execError = error;
            const message = error instanceof Error ? error.message : String(error);
            const stdout = outputPart(execError.stdout).trim();
            const stderr = outputPart(execError.stderr).trim();
            const details = [stdout && `stdout:\n${stdout}`, stderr && `stderr:\n${stderr}`].filter(Boolean).join("\n");
            const output = [`Shell command failed: ${message}`, details].filter(Boolean).join("\n");
            return { ok: false, output: output.slice(0, 3000) };
        }
    }
}
