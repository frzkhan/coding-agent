import path from "node:path";
import { describe, expect, it } from "vitest";
import { runAgentLoop } from "../src/agent/loop.js";
import { buildSystemPrompt } from "../src/agent/prompts.js";
import type { ChatMessage, LlmClient, LlmResponse } from "../src/llm/client.js";
import { GlobTool, ReadFileTool } from "../src/tools/fsTools.js";
import { ToolRegistry } from "../src/tools/types.js";

class FixtureClient implements LlmClient {
  private index = 0;

  constructor(private readonly responses: LlmResponse[]) {}

  async generate(_messages: ChatMessage[]): Promise<LlmResponse> {
    const response = this.responses[this.index];
    this.index += 1;
    return response;
  }
}

describe("integration smoke", () => {
  it("runs sample task against fixture repo in dry-run toolset", async () => {
    const fixtureRoot = path.resolve("test/fixtures/sample-repo");
    const registry = new ToolRegistry();
    registry.register(new ReadFileTool(fixtureRoot));
    registry.register(new GlobTool(fixtureRoot));

    const client = new FixtureClient([
      {
        text: "looking for files",
        done: false,
        toolCall: { name: "glob", arguments: { pattern: "**/*.md" } }
      },
      {
        text: "read readme",
        done: false,
        toolCall: { name: "readFile", arguments: { path: "README.md" } }
      },
      {
        text: "Found README and verified fixture content.",
        done: true
      }
    ]);

    const result = await runAgentLoop({
      llmClient: client,
      toolRegistry: registry,
      maxSteps: 5,
      systemPrompt: buildSystemPrompt(registry, fixtureRoot, ".\n  README.md"),
      task: "Summarize the fixture repository."
    });

    expect(result.stopReason).toBe("done");
    expect(result.finalResponse).toContain("README");
  });
});
