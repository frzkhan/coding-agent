import { glob } from "glob";
import { promises as fs } from "node:fs";
import path from "node:path";
import { assertReadablePath, globIgnorePatterns } from "./pathPolicy.js";
import type { Tool, ToolResult } from "./types.js";

const MAX_FILE_BYTES = 1_000_000;

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function isLikelyTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return !new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz", ".tar"]).has(ext);
}

function formatMatch(relativePath: string, lines: string[], lineIndex: number, context: number): string {
  const start = Math.max(0, lineIndex - context);
  const end = Math.min(lines.length - 1, lineIndex + context);
  const rendered = [];
  for (let i = start; i <= end; i += 1) {
    rendered.push(`${relativePath}:${i + 1}: ${lines[i]}`);
  }
  return rendered.join("\n");
}

/** Escape a string for use inside a RegExp source (substring search). */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Tokens from allWords: split on whitespace or commas, trim, drop empties. */
function parseAllWords(allWords: string): string[] {
  return allWords
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function lineContainsAllTokens(line: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const lower = line.toLowerCase();
  for (const t of tokens) {
    if (!lower.includes(t.toLowerCase())) return false;
  }
  return true;
}

export class SearchTool implements Tool {
  readonly name = "search";
  readonly parameters =
    '{ "pattern": "regex (omit or empty if using allWords)", "allWords": "keyword1 keyword2 (each must appear, case-insensitive)", "literal": false, "include": "src/**/*.ts", "context": 1, "maxResults": 50, "caseInsensitive": false }';
  readonly description =
    "Line search: regex via pattern, and/or allWords (AND keywords—good for UI phrases without knowing exact code). literal:true treats pattern as a fixed substring (escapes regex chars). include/context/maxResults/caseInsensitive optional.";

  constructor(private readonly workspaceRoot: string) {}

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const pattern = String(args.pattern ?? args.query ?? "").trim();
    const allWordsRaw = String(args.allWords ?? "").trim();
    const tokens = parseAllWords(allWordsRaw);

    if (!pattern && tokens.length === 0) {
      return { ok: false, output: `Missing pattern and allWords. Provide at least one. Args: ${this.parameters}` };
    }

    let regex: RegExp | null = null;
    if (pattern) {
      try {
        const source = args.literal === true ? escapeRegExp(pattern) : pattern;
        regex = new RegExp(source, args.caseInsensitive === true ? "i" : "");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, output: `Invalid regex: ${message}` };
      }
    }

    const include = String(args.include ?? "**/*");
    const context = clampInteger(args.context, 1, 0, 5);
    const maxResults = clampInteger(args.maxResults, 50, 1, 200);
    const matches: string[] = [];

    const files = await glob(include, {
      cwd: this.workspaceRoot,
      nodir: true,
      dot: true,
      ignore: globIgnorePatterns(this.workspaceRoot)
    });

    for (const relativePath of files) {
      if (matches.length >= maxResults) break;
      if (!isLikelyTextFile(relativePath)) continue;

      const { absolute } = assertReadablePath(this.workspaceRoot, relativePath);
      const stat = await fs.stat(absolute);
      if (stat.size > MAX_FILE_BYTES) continue;

      let content: string;
      try {
        content = await fs.readFile(absolute, "utf8");
      } catch {
        continue;
      }

      const lines = content.split(/\r?\n/);
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        if (!lineContainsAllTokens(line, tokens)) continue;
        if (regex) {
          regex.lastIndex = 0;
          if (!regex.test(line)) continue;
        }
        matches.push(formatMatch(relativePath, lines, lineIndex, context));
        if (matches.length >= maxResults) break;
      }
    }

    if (matches.length === 0) {
      return { ok: true, output: "No matches." };
    }
    return { ok: true, output: matches.join("\n---\n") };
  }
}
