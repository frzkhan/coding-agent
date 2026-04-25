import { glob } from "glob";
import { promises as fs } from "node:fs";
import path from "node:path";
import { assertReadablePath, globIgnorePatterns } from "./pathPolicy.js";
const MAX_FILE_BYTES = 1_000_000;
function clampInteger(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed))
        return fallback;
    return Math.min(max, Math.max(min, parsed));
}
function isLikelyTextFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return !new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz", ".tar"]).has(ext);
}
function formatMatch(relativePath, lines, lineIndex, context) {
    const start = Math.max(0, lineIndex - context);
    const end = Math.min(lines.length - 1, lineIndex + context);
    const rendered = [];
    for (let i = start; i <= end; i += 1) {
        rendered.push(`${relativePath}:${i + 1}: ${lines[i]}`);
    }
    return rendered.join("\n");
}
export class SearchTool {
    workspaceRoot;
    name = "search";
    parameters = '{ "pattern": "regex text", "include": "src/**/*.ts", "context": 1, "maxResults": 50 }';
    description = "Search text with a regular expression. Use pattern, not query; include/context/maxResults are optional.";
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
    }
    async run(args) {
        const pattern = String(args.pattern ?? args.query ?? "").trim();
        if (!pattern) {
            return { ok: false, output: `Missing pattern. Required args: ${this.parameters}` };
        }
        let regex;
        try {
            regex = new RegExp(pattern, args.caseInsensitive === true ? "i" : "");
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { ok: false, output: `Invalid regex: ${message}` };
        }
        const include = String(args.include ?? "**/*");
        const context = clampInteger(args.context, 1, 0, 5);
        const maxResults = clampInteger(args.maxResults, 50, 1, 200);
        const matches = [];
        const files = await glob(include, {
            cwd: this.workspaceRoot,
            nodir: true,
            dot: true,
            ignore: globIgnorePatterns(this.workspaceRoot)
        });
        for (const relativePath of files) {
            if (matches.length >= maxResults)
                break;
            if (!isLikelyTextFile(relativePath))
                continue;
            const { absolute } = assertReadablePath(this.workspaceRoot, relativePath);
            const stat = await fs.stat(absolute);
            if (stat.size > MAX_FILE_BYTES)
                continue;
            let content;
            try {
                content = await fs.readFile(absolute, "utf8");
            }
            catch {
                continue;
            }
            const lines = content.split(/\r?\n/);
            for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
                if (!regex.test(lines[lineIndex]))
                    continue;
                regex.lastIndex = 0;
                matches.push(formatMatch(relativePath, lines, lineIndex, context));
                if (matches.length >= maxResults)
                    break;
            }
        }
        if (matches.length === 0) {
            return { ok: true, output: "No matches." };
        }
        return { ok: true, output: matches.join("\n---\n") };
    }
}
