import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createMessageConnection, type MessageConnection } from "vscode-jsonrpc/node.js";
import { ToolExecutionError } from "../errors.js";

type LspPosition = { line: number; character: number };
type LspRange = { start: LspPosition; end: LspPosition };
type LspLocation = { uri: string; range: LspRange };

function resolveTlsCliPath(): string {
  const require = createRequire(import.meta.url);
  return require.resolve("typescript-language-server/lib/cli.mjs");
}

export function pathToDocumentUri(filePath: string): string {
  return pathToFileURL(filePath).href;
}

export function documentUriToPath(uri: string): string {
  if (uri.startsWith("file:")) {
    return fileURLToPath(uri);
  }
  return uri;
}

export function languageIdForPath(filePath: string): string {
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

export function formatLspPosition(uri: string, pos: LspPosition): string {
  const fsPath = documentUriToPath(uri);
  const rel = fsPath;
  return `${rel}:${pos.line + 1}:${pos.character}`;
}

export function formatLocation(loc: LspLocation, label?: string): string {
  const start = loc.range.start;
  const line = `${formatLspPosition(loc.uri, start)}${label ? `  ${label}` : ""}`;
  return line;
}

function isLocation(x: unknown): x is LspLocation {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.uri === "string" && o.range !== undefined;
}

function isLocationLink(x: unknown): x is {
  targetUri: string;
  targetRange: LspRange;
  targetSelectionRange?: LspRange;
} {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.targetUri === "string" && o.targetRange !== undefined;
}

/** Normalizes textDocument/definition responses to plain locations. */
function resolveInWorkspaceRoot(workspaceRoot: string, targetPath: string): string {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, targetPath);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new ToolExecutionError("Path is outside workspace root.");
  }
  return resolved;
}

export function flattenLocations(raw: unknown): LspLocation[] {
  if (raw == null) return [];
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
  private child: ChildProcessWithoutNullStreams | null = null;
  private connection: MessageConnection | null = null;
  private initPromise: Promise<void> | null = null;
  private exclusiveTail: Promise<unknown> = Promise.resolve();
  private openedUris = new Set<string>();

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  private readonly workspaceRoot: string;

  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.exclusiveTail.then(fn, fn);
    this.exclusiveTail = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private async ensureInit(): Promise<MessageConnection> {
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
  private async primeProject(connection: MessageConnection): Promise<void> {
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
      } catch {
        /* try next candidate */
      }
    }
  }

  private async spawnAndInitialize(): Promise<void> {
    let cliPath: string;
    try {
      cliPath = resolveTlsCliPath();
    } catch {
      throw new ToolExecutionError(
        "Could not resolve typescript-language-server. Run npm install in coding-agent."
      );
    }

    const child = spawn(process.execPath, [cliPath, "--stdio"], {
      cwd: this.workspaceRoot,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env
    });

    const stderrChunks: string[] = [];
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderrChunks.push(chunk);
    });

    await new Promise<void>((resolve, reject) => {
      child.on("error", reject);
      child.on("spawn", () => resolve());
    }).catch((err: unknown) => {
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
    } catch (e) {
      connection.dispose();
      child.kill();
      const tail = stderrChunks.join("").trim().slice(0, 500);
      const msg = e instanceof Error ? e.message : String(e);
      throw new ToolExecutionError(
        `LSP initialize failed: ${msg}${tail ? `\nServer stderr: ${tail}` : ""}`
      );
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

  async workspaceSymbol(query: string): Promise<string> {
    return this.runExclusive(async () => {
      const c = await this.ensureInit();
      const raw = await c.sendRequest("workspace/symbol", { query });
      if (!Array.isArray(raw) || raw.length === 0) {
        return query ? `No symbols matching "${query}".` : "No symbols returned.";
      }
      const lines: string[] = [];
      for (const item of raw) {
        if (!item || typeof item !== "object") continue;
        const o = item as Record<string, unknown>;
        const name = typeof o.name === "string" ? o.name : "?";
        const loc = o.location as LspLocation | undefined;
        if (loc && typeof loc.uri === "string" && loc.range?.start) {
          lines.push(formatLocation(loc, name));
        }
      }
      return lines.length ? lines.join("\n") : "No parseable symbol locations.";
    });
  }

  async ensureOpenDocument(filePath: string, text: string): Promise<string> {
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
  async definition(filePath: string, line: number, character: number): Promise<string> {
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

  async references(filePath: string, line: number, character: number): Promise<string> {
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
