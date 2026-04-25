import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { isIgnoredPath, loadGitignorePatterns } from "../tools/pathPolicy.js";

export type FileTreeOptions = {
  maxDepth?: number;
  maxEntries?: number;
};

export function buildFileTree(workspaceRoot: string, options: FileTreeOptions = {}): string {
  const root = path.resolve(workspaceRoot);
  const maxDepth = options.maxDepth ?? 4;
  const maxEntries = options.maxEntries ?? 120;
  const gitignorePatterns = loadGitignorePatterns(root);
  const lines: string[] = ["."];
  let entries = 0;
  let truncated = false;

  function visit(dir: string, depth: number): void {
    if (depth >= maxDepth || entries >= maxEntries) {
      truncated = true;
      return;
    }

    const children = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => {
        const rel = path.relative(root, path.join(dir, entry.name));
        return !isIgnoredPath(rel, gitignorePatterns);
      })
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    for (const child of children) {
      if (entries >= maxEntries) {
        truncated = true;
        return;
      }

      const absolute = path.join(dir, child.name);
      const rel = path.relative(root, absolute);
      const isDirectory = child.isDirectory();
      const suffix = isDirectory ? "/" : "";
      lines.push(`${"  ".repeat(depth + 1)}${child.name}${suffix}`);
      entries += 1;

      if (isDirectory && statSync(absolute).isDirectory()) {
        visit(absolute, depth + 1);
      }
      if (rel === "") return;
    }
  }

  visit(root, 0);

  if (truncated) {
    lines.push("  ...");
  }

  return lines.join("\n");
}
