import { glob } from "glob";
import { promises as fs } from "node:fs";
import path from "node:path";
import { assertReadablePath, globIgnorePatterns, resolveWorkspacePath } from "./pathPolicy.js";
function formatToolError(error) {
    return error instanceof Error ? error.message : String(error);
}
export class ReadFileTool {
    workspaceRoot;
    name = "readFile";
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
    }
    async run(args) {
        try {
            const targetPath = String(args.path ?? "");
            const { absolute } = assertReadablePath(this.workspaceRoot, targetPath);
            const content = await fs.readFile(absolute, "utf8");
            return { ok: true, output: content };
        }
        catch (error) {
            return { ok: false, output: formatToolError(error) };
        }
    }
}
export class WriteFileTool {
    workspaceRoot;
    name = "writeFile";
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
    }
    async run(args) {
        try {
            const targetPath = String(args.path ?? "");
            const content = String(args.content ?? "");
            const { absolute, relative } = resolveWorkspacePath(this.workspaceRoot, targetPath);
            if (relative === ".env") {
                return { ok: false, output: "Refusing to write .env." };
            }
            await fs.mkdir(path.dirname(absolute), { recursive: true });
            await fs.writeFile(absolute, content, "utf8");
            return { ok: true, output: `Wrote ${targetPath}` };
        }
        catch (error) {
            return { ok: false, output: formatToolError(error) };
        }
    }
}
export class StrReplaceTool {
    workspaceRoot;
    name = "str_replace";
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
    }
    async run(args) {
        try {
            const targetPath = String(args.path ?? "");
            const oldString = String(args.old_string ?? args.oldString ?? "");
            const newString = String(args.new_string ?? args.newString ?? "");
            if (!targetPath) {
                return { ok: false, output: "Missing path." };
            }
            if (!oldString) {
                return { ok: false, output: "Missing old_string." };
            }
            const { absolute } = assertReadablePath(this.workspaceRoot, targetPath);
            const content = await fs.readFile(absolute, "utf8");
            const matchCount = content.split(oldString).length - 1;
            if (matchCount === 0) {
                return { ok: false, output: "old_string was not found." };
            }
            if (matchCount > 1) {
                return { ok: false, output: `old_string matched ${matchCount} times; provide a unique replacement target.` };
            }
            await fs.writeFile(absolute, content.replace(oldString, newString), "utf8");
            return { ok: true, output: `Replaced text in ${targetPath}` };
        }
        catch (error) {
            return { ok: false, output: formatToolError(error) };
        }
    }
}
export class GlobTool {
    workspaceRoot;
    name = "glob";
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
    }
    async run(args) {
        const pattern = String(args.pattern ?? "");
        const files = await glob(pattern, {
            cwd: this.workspaceRoot,
            nodir: true,
            dot: true,
            ignore: globIgnorePatterns(this.workspaceRoot)
        });
        return { ok: true, output: files.join("\n") };
    }
}
