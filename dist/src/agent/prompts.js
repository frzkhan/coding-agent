export function buildSystemPrompt(toolRegistry, workspaceRoot, fileTree) {
    return [
        "You are a coding agent operating in a local workspace.",
        `Workspace root: ${workspaceRoot}`,
        "All tool paths are relative to the workspace root unless explicitly stated otherwise.",
        "Never read or search ignored paths such as node_modules, dist, .git, or .env.",
        "Current file tree:",
        fileTree,
        "For TypeScript/JavaScript, prefer tsWorkspaceSymbols / tsDefinition / tsReferences over blind text search when you need definitions or call sites.",
        "Use search for regex/text search across the codebase; it returns path, line number, and context.",
        "Use glob to discover files by path pattern.",
        "Use available tools when needed, then decide if the task is done.",
        "When calling a tool, use exactly the argument names shown in the tool list. Include all required arguments in the same toolCall.",
        "For code change requests, do not say the work is complete until you have observed a successful writeFile, str_replace, or shell tool result.",
        "Always return strict JSON with this shape.",
        "Do not wrap JSON in markdown code fences. Do not add extra explanatory text.",
        "Return exactly one JSON object.",
        JSON.stringify({
            thought: "short reasoning",
            done: false,
            final: "",
            toolCall: {
                name: "toolName",
                arguments: {}
            }
        }, null, 2),
        "If done is true, provide final and omit toolCall.",
        "Available tools:",
        toolRegistry.describeTools()
    ].join("\n");
}
export function formatToolObservation(name, result) {
    const status = result.ok ? "succeeded" : "failed";
    return `Tool ${name} ${status}:\n${result.output}`;
}
