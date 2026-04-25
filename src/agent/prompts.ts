import type { ToolRegistry, ToolResult } from "../tools/types.js";

export function buildSystemPrompt(toolRegistry: ToolRegistry, workspaceRoot: string, fileTree: string): string {
  return [
    "You are a coding agent operating in a local workspace.",
    `Workspace root: ${workspaceRoot}`,
    "All tool paths are relative to the workspace root unless explicitly stated otherwise.",
    "Never read or search ignored paths such as node_modules, dist, .git, or .env.",
    "Current file tree:",
    fileTree,
    "Verification is usually a `shell` command you choose from context: the file tree and root files (package.json, pyproject.toml, go.mod, Cargo.toml, etc.) signal the stack. When present, read CLAUDE.md, AGENTS.md, or CONTRIBUTING.md at the repo root for project-specific verify/test/lint commands—authors put exact scripts there to avoid guessing. For mixed repos, pick commands that match the area you edited (e.g. frontend vs python/).",
    "TypeScript/JavaScript LSP tools (tsWorkspaceSymbols, tsDefinition, tsReferences, tsHover) help with navigation and types; they are optional assists, not a substitute for running the project's own check via `shell` when you need to confirm the build or tests.",
    "When `POST_EDIT_VERIFY` is set, the loop runs that command automatically after each successful writeFile/str_replace. If it is unset, the loop does not run any automatic typecheck; use the `shell` tool for `tsc`, tests, linters, or call `tsDiagnostics` yourself when you need LSP-only hints. Do not treat LSP as a substitute for the project's own compiler or test command.",
    "You may readFile on .d.ts files under node_modules (e.g. after tsDefinition returns a declaration location) to inspect third-party API surfaces. Source .js/.ts files under node_modules remain blocked.",
    "Use search for regex/text search across the codebase; it returns path, line number, and context.",
    "Use glob to discover files by path pattern.",
    "Use available tools when needed, then decide if the task is done.",
    "When calling a tool, use exactly the argument names shown in the tool list. Include all required arguments in the same toolCall.",
    "For code change requests, do not say the work is complete until you have observed a successful writeFile, str_replace, or shell tool result.",
    "If the user pastes an error message, stack trace, traceback, or log snippet without an explicit instruction, treat it as an implicit request to diagnose the root cause in the workspace and apply a fix. Use search / readFile / tsWorkspaceSymbols to locate the offending code, then use str_replace or writeFile to fix it. Do not stop at explanation unless the error is clearly outside your control (third-party dependency, OS-level, or network).",
    "Always return strict JSON with this shape.",
    "Do not wrap JSON in markdown code fences. Do not add extra explanatory text.",
    "Return exactly one JSON object.",
    JSON.stringify(
      {
        thought: "short reasoning",
        done: false,
        final: "",
        toolCall: {
          name: "toolName",
          arguments: {}
        }
      },
      null,
      2
    ),
    "If done is true, provide final and omit toolCall.",
    "Available tools:",
    toolRegistry.describeTools()
  ].join("\n");
}

export function formatToolObservation(name: string, result: ToolResult): string {
  const status = result.ok ? "succeeded" : "failed";
  return `Tool ${name} ${status}:\n${result.output}`;
}
