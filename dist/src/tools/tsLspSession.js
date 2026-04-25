import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createMessageConnection } from "vscode-jsonrpc/node.js";
import { ToolExecutionError } from "../errors.js";
function resolveTlsCliPath() {
    const require = createRequire(import.meta.url);
    return require.resolve("typescript-language-server/lib/cli.mjs");
}
export function pathToDocumentUri(filePath) {
    return pathToFileURL(filePath).href;
}
export function documentUriToPath(uri) {
    if (uri.startsWith("file:")) {
        return fileURLToPath(uri);
    }
    return uri;
}
export function languageIdForPath(filePath) {
    switch (path.extname(filePath)) {
        case ".tsx":
            return "typescriptreact";
        case ".ts":
        case ".mts":
        case ".cts":
            return "typescript";
        case ".jsx":
            return "javascriptreact";
        case ".js":
        case ".cjs":
        case ".mjs":
            return "javascript";
        case ".json":
            return "json";
        default:
            return "typescript";
    }
}
export function formatLspPosition(uri, pos) {
    const fsPath = documentUriToPath(uri);
    const rel = fsPath;
    return `${rel}:${pos.line + 1}:${pos.character}`;
}
export function formatLocation(loc, label) {
    const start = loc.range.start;
    const line = `${formatLspPosition(loc.uri, start)}${label ? `  ${label}` : ""}`;
    return line;
}
function isLocation(x) {
    if (!x || typeof x !== "object")
        return false;
    const o = x;
    return typeof o.uri === "string" && o.range !== undefined;
}
function isLocationLink(x) {
    if (!x || typeof x !== "object")
        return false;
    const o = x;
    return typeof o.targetUri === "string" && o.targetRange !== undefined;
}
/** Normalizes textDocument/definition responses to plain locations. */
function resolveInWorkspaceRoot(workspaceRoot, targetPath) {
    const root = path.resolve(workspaceRoot);
    const resolved = path.resolve(root, targetPath);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
        throw new ToolExecutionError("Path is outside workspace root.");
    }
    return resolved;
}
export function flattenLocations(raw) {
    if (raw == null)
        return [];
    if (Array.isArray(raw)) {
        return raw.flatMap((item) => flattenLocations(item));
    }
    if (isLocation(raw)) {
        return [raw];
    }
    if (isLocationLink(raw)) {
        return [
            {
                uri: raw.targetUri,
                range: raw.targetSelectionRange ?? raw.targetRange
            }
        ];
    }
    return [];
}
export class TsLanguageServerSession {
    child = null;
    connection = null;
    initPromise = null;
    exclusiveTail = Promise.resolve();
    openedUris = new Set();
    constructor(workspaceRoot) {
        this.workspaceRoot = path.resolve(workspaceRoot);
    }
    workspaceRoot;
    runExclusive(fn) {
        const next = this.exclusiveTail.then(fn, fn);
        this.exclusiveTail = next.then(() => undefined, () => undefined);
        return next;
    }
    async ensureInit() {
        if (this.connection) {
            return this.connection;
        }
        if (!this.initPromise) {
            this.initPromise = this.spawnAndInitialize();
        }
        await this.initPromise;
        if (!this.connection) {
            throw new ToolExecutionError("TypeScript language server failed to start.");
        }
        return this.connection;
    }
    /** Opens a source file so tsserver loads a project (required before workspace/symbol). */
    async primeProject(connection) {
        const candidates = ["src/index.ts", "src/main.ts", "index.ts", "main.ts"];
        for (const rel of candidates) {
            const full = path.join(this.workspaceRoot, rel);
            try {
                const text = await fs.readFile(full, "utf8");
                const uri = pathToDocumentUri(full);
                connection.sendNotification("textDocument/didOpen", {
                    textDocument: {
                        uri,
                        languageId: languageIdForPath(full),
                        version: 1,
                        text
                    }
                });
                this.openedUris.add(uri);
                return;
            }
            catch {
                /* try next candidate */
            }
        }
    }
    async spawnAndInitialize() {
        let cliPath;
        try {
            cliPath = resolveTlsCliPath();
        }
        catch {
            throw new ToolExecutionError("Could not resolve typescript-language-server. Run npm install in coding-agent.");
        }
        const child = spawn(process.execPath, [cliPath, "--stdio"], {
            cwd: this.workspaceRoot,
            stdio: ["pipe", "pipe", "pipe"],
            env: process.env
        });
        const stderrChunks = [];
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk) => {
            stderrChunks.push(chunk);
        });
        await new Promise((resolve, reject) => {
            child.on("error", reject);
            child.on("spawn", () => resolve());
        }).catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            throw new ToolExecutionError(`Failed to spawn typescript-language-server: ${message}`);
        });
        const connection = createMessageConnection(child.stdout, child.stdin);
        connection.onError((err) => {
            void err;
        });
        connection.listen();
        const rootUri = pathToFileURL(this.workspaceRoot).href;
        try {
            await connection.sendRequest("initialize", {
                processId: process.pid,
                clientInfo: { name: "coding-agent", version: "1.0.0" },
                rootUri,
                capabilities: {},
                workspaceFolders: [
                    {
                        uri: rootUri,
                        name: path.basename(this.workspaceRoot) || "workspace"
                    }
                ]
            });
        }
        catch (e) {
            connection.dispose();
            child.kill();
            const tail = stderrChunks.join("").trim().slice(0, 500);
            const msg = e instanceof Error ? e.message : String(e);
            throw new ToolExecutionError(`LSP initialize failed: ${msg}${tail ? `\nServer stderr: ${tail}` : ""}`);
        }
        connection.sendNotification("initialized", {});
        await this.primeProject(connection);
        this.child = child;
        this.connection = connection;
        child.on("exit", (code, signal) => {
            if (this.child === child) {
                this.child = null;
                this.connection = null;
                this.initPromise = null;
                this.openedUris.clear();
            }
            void code;
            void signal;
        });
    }
    async workspaceSymbol(query) {
        return this.runExclusive(async () => {
            const c = await this.ensureInit();
            const raw = await c.sendRequest("workspace/symbol", { query });
            if (!Array.isArray(raw) || raw.length === 0) {
                return query ? `No symbols matching "${query}".` : "No symbols returned.";
            }
            const lines = [];
            for (const item of raw) {
                if (!item || typeof item !== "object")
                    continue;
                const o = item;
                const name = typeof o.name === "string" ? o.name : "?";
                const loc = o.location;
                if (loc && typeof loc.uri === "string" && loc.range?.start) {
                    lines.push(formatLocation(loc, name));
                }
            }
            return lines.length ? lines.join("\n") : "No parseable symbol locations.";
        });
    }
    async ensureOpenDocument(filePath, text) {
        const uri = pathToDocumentUri(filePath);
        if (this.openedUris.has(uri)) {
            return uri;
        }
        const c = await this.ensureInit();
        c.sendNotification("textDocument/didOpen", {
            textDocument: {
                uri,
                languageId: languageIdForPath(filePath),
                version: 1,
                text
            }
        });
        this.openedUris.add(uri);
        return uri;
    }
    /** @param line — 1-based line index (editor-style). @param character — 0-based UTF-16 column (LSP). */
    async definition(filePath, line, character) {
        return this.runExclusive(async () => {
            const resolved = resolveInWorkspaceRoot(this.workspaceRoot, filePath);
            const text = await fs.readFile(resolved, "utf8");
            const uri = await this.ensureOpenDocument(resolved, text);
            const c = await this.ensureInit();
            const lspLine = Math.max(0, line - 1);
            const raw = await c.sendRequest("textDocument/definition", {
                textDocument: { uri },
                position: { line: lspLine, character }
            });
            const locs = flattenLocations(raw);
            if (locs.length === 0) {
                return "No definition found at that position.";
            }
            return locs.map((l) => formatLocation(l)).join("\n");
        });
    }
    async references(filePath, line, character) {
        return this.runExclusive(async () => {
            const resolved = resolveInWorkspaceRoot(this.workspaceRoot, filePath);
            const text = await fs.readFile(resolved, "utf8");
            const uri = await this.ensureOpenDocument(resolved, text);
            const c = await this.ensureInit();
            const lspLine = Math.max(0, line - 1);
            const raw = await c.sendRequest("textDocument/references", {
                textDocument: { uri },
                position: { line: lspLine, character },
                context: { includeDeclaration: true }
            });
            if (!Array.isArray(raw) || raw.length === 0) {
                return "No references found at that position.";
            }
            const locs = raw.filter(isLocation);
            return locs.map((l) => formatLocation(l)).join("\n");
        });
    }
}
