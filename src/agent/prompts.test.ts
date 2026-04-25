import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./prompts.js";
import { ToolRegistry, type Tool } from "../tools/types.js";

class ExampleTool implements Tool {
  readonly name = "example";
  readonly parameters = '{ "path": "src/file.ts", "old_string": "before", "new_string": "after" }';
  readonly description = "Example edit tool.";

  async run() {
    return { ok: true, output: "ok" };
  }
}

describe("buildSystemPrompt", () => {
  it("includes tool argument schemas so the model does not guess parameters", () => {
    const registry = new ToolRegistry();
    registry.register(new ExampleTool());

    const prompt = buildSystemPrompt(registry, "/workspace", "src/index.ts");

    expect(prompt).toContain("When calling a tool, use exactly the argument names shown");
    expect(prompt).toContain('- example - args: { "path": "src/file.ts"');
    expect(prompt).toContain('"old_string": "before"');
  });
});
