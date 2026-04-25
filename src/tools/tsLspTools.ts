import { ToolExecutionError } from "../errors.js";
import type { Tool, ToolResult } from "./types.js";
import { TsLanguageServerSession } from "./tsLspSession.js";

function parseLineChar(args: Record<string, unknown>): { line: number; character: number } | null {
  const line = Number(args.line);
  const character = Number(args.character);
  if (!Number.isInteger(line) || line < 1) return null;
  if (!Number.isInteger(character) || character < 0) return null;
  return { line, character };
}

/** Project-wide symbol search (workspace/symbol). Use for names like `login`, `handleSubmit`. */
export class TsWorkspaceSymbolsTool implements Tool {
  readonly name = "tsWorkspaceSymbols";
  readonly parameters = '{ "query": "symbol name substring" }';
  readonly description = "Search TypeScript/JavaScript symbols across the workspace.";

  constructor(private readonly session: TsLanguageServerSession) {}

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const query = String(args.query ?? "").trim();
    if (!query) {
      return { ok: false, output: "Missing query (symbol name substring)." };
    }
    try {
      const out = await this.session.workspaceSymbol(query);
      return { ok: true, output: out };
    } catch (e) {
      const message = e instanceof ToolExecutionError ? e.message : String(e);
      return { ok: false, output: message };
    }
  }
}

/** Go to definition at a position. Line is 1-based; character is 0-based UTF-16 column (same as VS Code status bar). */
export class TsDefinitionTool implements Tool {
  readonly name = "tsDefinition";
  readonly parameters = '{ "path": "src/file.ts", "line": 1, "character": 0 }';
  readonly description = "Find the definition at a TypeScript/JavaScript source position.";

  constructor(private readonly session: TsLanguageServerSession) {}

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = String(args.path ?? "").trim();
    if (!filePath) {
      return { ok: false, output: "Missing path (file relative to workspace)." };
    }
    const pos = parseLineChar(args);
    if (!pos) {
      return { ok: false, output: "Missing or invalid line (1-based) and character (0-based)." };
    }
    try {
      const out = await this.session.definition(filePath, pos.line, pos.character);
      return { ok: true, output: out };
    } catch (e) {
      const message = e instanceof ToolExecutionError ? e.message : String(e);
      return { ok: false, output: message };
    }
  }
}

/** Find all references at a position. Same line/character rules as tsDefinition. */
export class TsReferencesTool implements Tool {
  readonly name = "tsReferences";
  readonly parameters = '{ "path": "src/file.ts", "line": 1, "character": 0 }';
  readonly description = "Find references at a TypeScript/JavaScript source position.";

  constructor(private readonly session: TsLanguageServerSession) {}

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = String(args.path ?? "").trim();
    if (!filePath) {
      return { ok: false, output: "Missing path (file relative to workspace)." };
    }
    const pos = parseLineChar(args);
    if (!pos) {
      return { ok: false, output: "Missing or invalid line (1-based) and character (0-based)." };
    }
    try {
      const out = await this.session.references(filePath, pos.line, pos.character);
      return { ok: true, output: out };
    } catch (e) {
      const message = e instanceof ToolExecutionError ? e.message : String(e);
      return { ok: false, output: message };
    }
  }
}

/** Hover info at a position. Returns the type/signature the LSP would show on hover. */
export class TsHoverTool implements Tool {
  readonly name = "tsHover";
  readonly parameters = '{ "path": "src/file.ts", "line": 1, "character": 0 }';
  readonly description =
    "Show the type signature / doc for the symbol at a TypeScript/JavaScript source position. Use this before calling methods you are unsure about.";

  constructor(private readonly session: TsLanguageServerSession) {}

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = String(args.path ?? "").trim();
    if (!filePath) {
      return { ok: false, output: "Missing path (file relative to workspace)." };
    }
    const pos = parseLineChar(args);
    if (!pos) {
      return { ok: false, output: "Missing or invalid line (1-based) and character (0-based)." };
    }
    try {
      const out = await this.session.hover(filePath, pos.line, pos.character);
      return { ok: true, output: out };
    } catch (e) {
      const message = e instanceof ToolExecutionError ? e.message : String(e);
      return { ok: false, output: message };
    }
  }
}

/**
 * TypeScript compile diagnostics for a single file. The loop also auto-runs
 * this after a successful writeFile / str_replace on a .ts/.tsx file, so you
 * typically will not need to call it by hand.
 */
export class TsDiagnosticsTool implements Tool {
  readonly name = "tsDiagnostics";
  readonly parameters = '{ "path": "src/file.ts" }';
  readonly description =
    "Return TypeScript compile errors and warnings for a file. Run this after editing a .ts/.tsx file to verify the change compiles.";

  constructor(private readonly session: TsLanguageServerSession) {}

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = String(args.path ?? "").trim();
    if (!filePath) {
      return { ok: false, output: "Missing path (file relative to workspace)." };
    }
    try {
      const out = await this.session.diagnostics(filePath);
      return { ok: true, output: out };
    } catch (e) {
      const message = e instanceof ToolExecutionError ? e.message : String(e);
      return { ok: false, output: message };
    }
  }
}
