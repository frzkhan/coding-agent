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
