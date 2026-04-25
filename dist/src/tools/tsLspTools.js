import { ToolExecutionError } from "../errors.js";
function parseLineChar(args) {
    const line = Number(args.line);
    const character = Number(args.character);
    if (!Number.isInteger(line) || line < 1)
        return null;
    if (!Number.isInteger(character) || character < 0)
        return null;
    return { line, character };
}
/** Project-wide symbol search (workspace/symbol). Use for names like `login`, `handleSubmit`. */
export class TsWorkspaceSymbolsTool {
    session;
    name = "tsWorkspaceSymbols";
    parameters = '{ "query": "symbol name substring" }';
    description = "Search TypeScript/JavaScript symbols across the workspace.";
    constructor(session) {
        this.session = session;
    }
    async run(args) {
        const query = String(args.query ?? "").trim();
        if (!query) {
            return { ok: false, output: "Missing query (symbol name substring)." };
        }
        try {
            const out = await this.session.workspaceSymbol(query);
            return { ok: true, output: out };
        }
        catch (e) {
            const message = e instanceof ToolExecutionError ? e.message : String(e);
            return { ok: false, output: message };
        }
    }
}
/** Go to definition at a position. Line is 1-based; character is 0-based UTF-16 column (same as VS Code status bar). */
export class TsDefinitionTool {
    session;
    name = "tsDefinition";
    parameters = '{ "path": "src/file.ts", "line": 1, "character": 0 }';
    description = "Find the definition at a TypeScript/JavaScript source position.";
    constructor(session) {
        this.session = session;
    }
    async run(args) {
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
        }
        catch (e) {
            const message = e instanceof ToolExecutionError ? e.message : String(e);
            return { ok: false, output: message };
        }
    }
}
/** Find all references at a position. Same line/character rules as tsDefinition. */
export class TsReferencesTool {
    session;
    name = "tsReferences";
    parameters = '{ "path": "src/file.ts", "line": 1, "character": 0 }';
    description = "Find references at a TypeScript/JavaScript source position.";
    constructor(session) {
        this.session = session;
    }
    async run(args) {
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
        }
        catch (e) {
            const message = e instanceof ToolExecutionError ? e.message : String(e);
            return { ok: false, output: message };
        }
    }
}
/** Hover info at a position. Returns the type/signature the LSP would show on hover. */
export class TsHoverTool {
    session;
    name = "tsHover";
    parameters = '{ "path": "src/file.ts", "line": 1, "character": 0 }';
    description = "Show the type signature / doc for the symbol at a TypeScript/JavaScript source position. Use this before calling methods you are unsure about.";
    constructor(session) {
        this.session = session;
    }
    async run(args) {
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
        }
        catch (e) {
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
export class TsDiagnosticsTool {
    session;
    name = "tsDiagnostics";
    parameters = '{ "path": "src/file.ts" }';
    description = "Return TypeScript compile errors and warnings for a file. Run this after editing a .ts/.tsx file to verify the change compiles.";
    constructor(session) {
        this.session = session;
    }
    async run(args) {
        const filePath = String(args.path ?? "").trim();
        if (!filePath) {
            return { ok: false, output: "Missing path (file relative to workspace)." };
        }
        try {
            const out = await this.session.diagnostics(filePath);
            return { ok: true, output: out };
        }
        catch (e) {
            const message = e instanceof ToolExecutionError ? e.message : String(e);
            return { ok: false, output: message };
        }
    }
}
