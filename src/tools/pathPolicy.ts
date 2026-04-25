import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ToolExecutionError } from "../errors.js";

const DEFAULT_IGNORED_DIRS = new Set([".git", "node_modules", "dist"]);

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function stripLeadingSlash(value: string): string {
  return value.replace(/^\/+/, "");
}

function globPatternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}

export function resolveWorkspacePath(workspaceRoot: string, targetPath: string): { absolute: string; relative: string } {
  const root = path.resolve(workspaceRoot);
  const absolute = path.resolve(root, targetPath);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new ToolExecutionError("Path is outside workspace root.");
  }
  return {
    absolute,
    relative: toPosixPath(path.relative(root, absolute))
  };
}

export function loadGitignorePatterns(workspaceRoot: string): string[] {
  const gitignorePath = path.join(workspaceRoot, ".gitignore");
  if (!existsSync(gitignorePath)) return [];

  return readFileSync(gitignorePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"));
}

export function isIgnoredPath(relativePath: string, gitignorePatterns: string[] = []): boolean {
  const normalized = stripLeadingSlash(toPosixPath(relativePath));
  if (!normalized) return false;

  const parts = normalized.split("/");
  if (parts.some((part) => DEFAULT_IGNORED_DIRS.has(part))) return true;
  if (parts.at(-1) === ".env") return true;

  return gitignorePatterns.some((pattern) => {
    const normalizedPattern = stripLeadingSlash(pattern);
    if (!normalizedPattern) return false;

    if (normalizedPattern.endsWith("/")) {
      const dir = normalizedPattern.slice(0, -1);
      return parts.includes(dir) || normalized.startsWith(`${dir}/`);
    }

    if (!normalizedPattern.includes("/") && !normalizedPattern.includes("*")) {
      return parts.includes(normalizedPattern);
    }

    if (normalizedPattern.includes("*")) {
      return globPatternToRegExp(normalizedPattern).test(normalized);
    }

    return normalized === normalizedPattern || normalized.startsWith(`${normalizedPattern}/`);
  });
}

export function assertReadablePath(workspaceRoot: string, targetPath: string): { absolute: string; relative: string } {
  const resolved = resolveWorkspacePath(workspaceRoot, targetPath);
  const gitignorePatterns = loadGitignorePatterns(workspaceRoot);
  if (isIgnoredPath(resolved.relative, gitignorePatterns)) {
    throw new ToolExecutionError(`Path is ignored and cannot be accessed: ${resolved.relative}`);
  }
  return resolved;
}

export function globIgnorePatterns(workspaceRoot: string): string[] {
  return [
    "**/.git/**",
    "**/node_modules/**",
    "**/dist/**",
    ".env",
    "**/.env",
    ...loadGitignorePatterns(workspaceRoot)
  ];
}
