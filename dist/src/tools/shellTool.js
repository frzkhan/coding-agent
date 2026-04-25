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
            return { ok: false, output: "Missing command." };
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
