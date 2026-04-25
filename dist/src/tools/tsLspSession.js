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
function severityLabel(severity) {
    switch (severity) {
        case 1:
            return "error";
        case 2:
            return "warning";
        case 3:
            return "info";
        case 4:
            return "hint";
        default:
            return "info";
    }
}
export function formatDiagnostics(relativePath, diagnostics) {
    if (!diagnostics.length)
        return "No TypeScript errors or warnings.";
    return diagnostics
        .map((d) => {
        const start = d.range.start;
        const line = start.line + 1;
        const char = start.character;
        const code = d.code !== undefined && d.code !== "" ? ` ${d.code}` : "";
        return `${relativePath}:${line}:${char} ${severityLabel(d.severity)}${code}: ${d.message}`;
    })
        .join("\n");
}
export function formatHoverContents(raw) {
    if (!raw || typeof raw !== "object")
        return "No hover information at that position.";
    const o = raw;
    const contents = o.contents;
    if (contents == null)
        return "No hover information at that position.";
    const flatten = (item) => {
        if (typeof item === "string")
            return item;
        if (item && typeof item === "object") {
            const inner = item;
            if (typeof inner.value === "string")
                return inner.value;
        }
        return "";
    };
    const text = Array.isArray(contents)
        ? contents.map(flatten).filter(Boolean).join("\n\n")
        : flatten(contents);
    const trimmed = text.trim();
    return trimmed.length ? trimmed : "No hover information at that position.";
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
    documentVersions = new Map();
    latestDiagnostics = new Map();
    diagnosticsWaiters = new Map();
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
        connection.onNotification("textDocument/publishDiagnostics", (params) => {
            this.latestDiagnostics.set(params.uri, params.diagnostics ?? []);
            const waiters = this.diagnosticsWaiters.get(params.uri);
            if (waiters) {
                for (const waiter of waiters)
                    waiter(params.diagnostics ?? []);
            }
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
                this.documentVersions.clear();
                this.latestDiagnostics.clear();
                this.diagnosticsWaiters.clear();
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
        const version = 1;
        this.documentVersions.set(uri, version);
        c.sendNotification("textDocument/didOpen", {
            textDocument: {
                uri,
                languageId: languageIdForPath(filePath),
                version,
                text
            }
        });
        this.openedUris.add(uri);
        return uri;
    }
    /** Reads the current disk content and sends didOpen (first time) or didChange (subsequent). */
    async syncDocument(resolvedPath) {
        const text = await fs.readFile(resolvedPath, "utf8");
        const uri = pathToDocumentUri(resolvedPath);
        // The next published diagnostics are for the content we are about to sync; do not merge with a
        // pre-change "clean" result while we wait.
        this.latestDiagnostics.delete(uri);
        const c = await this.ensureInit();
        const nextVersion = (this.documentVersions.get(uri) ?? 0) + 1;
        this.documentVersions.set(uri, nextVersion);
        if (this.openedUris.has(uri)) {
            c.sendNotification("textDocument/didChange", {
                textDocument: { uri, version: nextVersion },
                contentChanges: [{ text }]
            });
        }
        else {
            c.sendNotification("textDocument/didOpen", {
                textDocument: {
                    uri,
                    languageId: languageIdForPath(resolvedPath),
                    version: nextVersion,
                    text
                }
            });
            this.openedUris.add(uri);
        }
        return uri;
    }
    /**
     * Wait until tsserver has had time to republish after didChange. It often sends an early empty
     * `publishDiagnostics` and only later sends the real set (e.g. after parsing). We must not treat
     * that first empty batch as final: debouncing the empty case caused false "no errors" in
     * ~500ms. Only an all-clear after `maxWaitMs`, or a non-empty batch settled with a short debounce.
     */
    waitForDiagnostics(uri, maxWaitMs, quietWhenNonEmptyMs = 400) {
        return new Promise((resolve) => {
            let latest = [];
            let debounceTimer;
            let maxTimer;
            let finished = false;
            const removeListener = () => {
                const current = this.diagnosticsWaiters.get(uri) ?? [];
                const filtered = current.filter((w) => w !== listener);
                if (filtered.length)
                    this.diagnosticsWaiters.set(uri, filtered);
                else
                    this.diagnosticsWaiters.delete(uri);
            };
            const finish = (value) => {
                if (finished)
                    return;
                finished = true;
                if (debounceTimer)
                    clearTimeout(debounceTimer);
                if (maxTimer)
                    clearTimeout(maxTimer);
                removeListener();
                resolve(value);
            };
            const listener = (diagnostics) => {
                latest = diagnostics;
                if (debounceTimer) {
                    clearTimeout(debounceTimer);
                    debounceTimer = undefined;
                }
                if (diagnostics.length > 0) {
                    debounceTimer = setTimeout(() => {
                        finish(this.latestDiagnostics.get(uri) ?? latest);
                    }, quietWhenNonEmptyMs);
                }
                // Empty: do not finish on a short debounce; wait for maxWaitMs or a later non-empty publish.
            };
            const existing = this.diagnosticsWaiters.get(uri) ?? [];
            existing.push(listener);
            this.diagnosticsWaiters.set(uri, existing);
            maxTimer = setTimeout(() => {
                finish(this.latestDiagnostics.get(uri) ?? latest);
            }, maxWaitMs);
        });
    }
    /** @param line — 1-based line index (editor-style). @param character — 0-based UTF-16 column (LSP). */
    async definition(filePath, line, character) {
        return this.runExclusive(async () => {
            const resolved = resolveInWorkspaceRoot(this.workspaceRoot, filePath);
            const uri = await this.syncDocument(resolved);
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
    async hover(filePath, line, character) {
        return this.runExclusive(async () => {
            const resolved = resolveInWorkspaceRoot(this.workspaceRoot, filePath);
            const uri = await this.syncDocument(resolved);
            const c = await this.ensureInit();
            const lspLine = Math.max(0, line - 1);
            const raw = await c.sendRequest("textDocument/hover", {
                textDocument: { uri },
                position: { line: lspLine, character }
            });
            return formatHoverContents(raw);
        });
    }
    async diagnostics(filePath, timeoutMs = 10_000) {
        return this.runExclusive(async () => {
            const resolved = resolveInWorkspaceRoot(this.workspaceRoot, filePath);
            const uri = await this.syncDocument(resolved);
            const diagnostics = await this.waitForDiagnostics(uri, timeoutMs);
            const relative = path.relative(this.workspaceRoot, resolved) || filePath;
            return formatDiagnostics(relative, diagnostics);
        });
    }
    async references(filePath, line, character) {
        return this.runExclusive(async () => {
            const resolved = resolveInWorkspaceRoot(this.workspaceRoot, filePath);
            const uri = await this.syncDocument(resolved);
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
