import { glob } from "glob";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Tool, ToolResult } from "./types.js";
import { assertReadablePath, globIgnorePatterns, resolveWorkspacePath } from "./pathPolicy.js";

function formatToolError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ReadFileTool implements Tool {
  readonly name = "readFile";
  readonly parameters = '{ "path": "relative/file.txt" }';
  readonly description = "Read a text file from the workspace.";

  constructor(private readonly workspaceRoot: string) {}

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const targetPath = String(args.path ?? "");
      const { absolute } = assertReadablePath(this.workspaceRoot, targetPath);
      const content = await fs.readFile(absolute, "utf8");
      return { ok: true, output: content };
    } catch (error) {
      return { ok: false, output: formatToolError(error) };
    }
  }
}

export class WriteFileTool implements Tool {
  readonly name = "writeFile";
  readonly parameters = '{ "path": "relative/file.txt", "content": "full file contents" }';
  readonly description = "Create or overwrite a workspace file.";

  constructor(private readonly workspaceRoot: string) {}

  async run(args: Record<string, unknown>): Promise<ToolResult> {
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
    } catch (error) {
      return { ok: false, output: formatToolError(error) };
    }
  }
}

export class StrReplaceTool implements Tool {
  readonly name = "str_replace";
  readonly parameters = '{ "path": "relative/file.txt", "old_string": "exact unique text", "new_string": "replacement text" }';
  readonly description = "Replace exactly one occurrence in an existing file. Use readFile first if you need exact text.";

  constructor(private readonly workspaceRoot: string) {}

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const targetPath = String(args.path ?? "");
      const oldString = String(args.old_string ?? args.oldString ?? "");
      const newString = String(args.new_string ?? args.newString ?? "");
      if (!targetPath) {
        return { ok: false, output: `Missing path. Required args: ${this.parameters}` };
      }
      if (!oldString) {
        return { ok: false, output: `Missing old_string. Required args: ${this.parameters}` };
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
    } catch (error) {
      return { ok: false, output: formatToolError(error) };
    }
  }
}

export class GlobTool implements Tool {
  readonly name = "glob";
  readonly parameters = '{ "pattern": "src/**/*.ts" }';
  readonly description = "List workspace files matching a glob pattern.";

  constructor(private readonly workspaceRoot: string) {}

  async run(args: Record<string, unknown>): Promise<ToolResult> {
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
