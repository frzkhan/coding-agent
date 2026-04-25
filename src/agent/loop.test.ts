import { describe, expect, it } from "vitest";
import { runAgentLoop } from "./loop.js";
import type { ChatMessage, LlmClient, LlmResponse } from "../llm/client.js";
import { ToolRegistry, type Tool } from "../tools/types.js";

class SequenceClient implements LlmClient {
  private index = 0;

  constructor(private readonly responses: LlmResponse[]) {}

  async generate(_messages: ChatMessage[]): Promise<LlmResponse> {
    const response = this.responses[this.index];
    this.index += 1;
    return response;
  }
}

class EchoTool implements Tool {
  readonly name = "echo";

  async run(args: Record<string, unknown>) {
    return { ok: true, output: `echo:${String(args.value ?? "")}` };
  }
}

class ThrowTool implements Tool {
  readonly name = "throw";

  async run(): Promise<never> {
    throw new Error("boom");
  }
}

class MutatingTool implements Tool {
  readonly name = "str_replace";

  async run() {
    return { ok: true, output: "Replaced text in src/file.ts" };
  }
}

describe("runAgentLoop", () => {
  it("finishes when model returns done", async () => {
    const registry = new ToolRegistry();
    const client = new SequenceClient([
      { text: "All done", done: true }
    ]);

    const result = await runAgentLoop({
      llmClient: client,
      toolRegistry: registry,
      maxSteps: 3,
      systemPrompt: "system",
      task: "task"
    });

    expect(result.stopReason).toBe("done");
    expect(result.finalResponse).toBe("All done");
  });

  it("runs a tool and then completes", async () => {
    const registry = new ToolRegistry();
    registry.register(new EchoTool());
    const client = new SequenceClient([
      {
        text: "need tool",
        done: false,
        toolCall: { name: "echo", arguments: { value: "hello" } }
      },
      { text: "complete", done: true }
    ]);

    const result = await runAgentLoop({
      llmClient: client,
      toolRegistry: registry,
      maxSteps: 3,
      systemPrompt: "system",
      task: "task"
    });

    expect(result.stopReason).toBe("done");
    expect(result.steps).toBe(2);
  });

  it("reports model thoughts, tool call details, and tool result in step updates", async () => {
    const registry = new ToolRegistry();
    registry.register(new EchoTool());
    const updates: string[] = [];
    const client = new SequenceClient([
      {
        text: "Inspecting the requested value before answering.",
        done: false,
        toolCall: { name: "echo", arguments: { value: "hello" } }
      },
      { text: "complete", done: true }
    ]);

    await runAgentLoop({
      llmClient: client,
      toolRegistry: registry,
      maxSteps: 3,
      systemPrompt: "system",
      task: "task",
      onStep: (_step, info) => updates.push(info)
    });

    expect(updates.some((info) => info.includes("Thought: Inspecting"))).toBe(true);
    expect(updates.some((info) => info.includes("Calling tool: echo") && info.includes('value="hello"'))).toBe(true);
    expect(updates.some((info) => info.includes("Tool succeeded: echo:hello"))).toBe(true);
  });

  it("does not accept a change-complete final answer before a mutating tool succeeds", async () => {
    const registry = new ToolRegistry();
    const updates: string[] = [];
    const client = new SequenceClient([
      { text: "CLI updated.", done: true }
    ]);

    const result = await runAgentLoop({
      llmClient: client,
      toolRegistry: registry,
      maxSteps: 1,
      systemPrompt: "system",
      task: "Update the CLI output",
      onStep: (_step, info) => updates.push(info)
    });

    expect(result.stopReason).toBe("max_steps_reached");
    expect(updates.some((info) => info.startsWith("Rejected final answer:"))).toBe(true);
    expect(updates.some((info) => info === "Model produced final answer")).toBe(false);
  });

  it("accepts a change-complete final answer after a mutating tool succeeds", async () => {
    const registry = new ToolRegistry();
    registry.register(new MutatingTool());
    const client = new SequenceClient([
      {
        text: "need edit",
        done: false,
        toolCall: { name: "str_replace", arguments: { path: "src/file.ts", old_string: "a", new_string: "b" } }
      },
      { text: "CLI updated.", done: true }
    ]);

    const result = await runAgentLoop({
      llmClient: client,
      toolRegistry: registry,
      maxSteps: 2,
      systemPrompt: "system",
      task: "Update the CLI output"
    });

    expect(result.stopReason).toBe("done");
    expect(result.finalResponse).toBe("CLI updated.");
  });

  it("aggregates token usage across model calls", async () => {
    const registry = new ToolRegistry();
    registry.register(new EchoTool());
    const client = new SequenceClient([
      {
        text: "need tool",
        done: false,
        toolCall: { name: "echo", arguments: { value: "hello" } },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, source: "provider" }
      },
      {
        text: "complete",
        done: true,
        usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16, source: "provider" }
      }
    ]);

    const result = await runAgentLoop({
      llmClient: client,
      toolRegistry: registry,
      maxSteps: 3,
      systemPrompt: "system",
      task: "task"
    });

    expect(result.tokenUsage).toEqual({
      inputTokens: 22,
      outputTokens: 9,
      totalTokens: 31,
      source: "provider"
    });
  });

  it("stops at max steps", async () => {
    const registry = new ToolRegistry();
    registry.register(new EchoTool());
    const client = new SequenceClient([
      {
        text: "need tool",
        done: false,
        toolCall: { name: "echo", arguments: { value: "a" } }
      },
      {
        text: "need tool again",
        done: false,
        toolCall: { name: "echo", arguments: { value: "b" } }
      }
    ]);

    const result = await runAgentLoop({
      llmClient: client,
      toolRegistry: registry,
      maxSteps: 1,
      systemPrompt: "system",
      task: "task"
    });

    expect(result.stopReason).toBe("max_steps_reached");
  });

  it("continues with provided message history", async () => {
    const registry = new ToolRegistry();
    const client = new SequenceClient([{ text: "follow-up done", done: true }]);
    const existingMessages: ChatMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "first request" },
      { role: "assistant", content: "first answer" }
    ];

    const result = await runAgentLoop({
      llmClient: client,
      toolRegistry: registry,
      maxSteps: 2,
      systemPrompt: "system",
      task: "second request",
      messages: existingMessages
    });

    expect(result.stopReason).toBe("done");
    expect(result.messages.at(0)?.role).toBe("system");
    expect(result.messages.some((m) => m.content === "second request")).toBe(true);
  });

  it("forwards thrown tool errors back into message history", async () => {
    const registry = new ToolRegistry();
    registry.register(new ThrowTool());
    const client = new SequenceClient([
      {
        text: "need tool",
        done: false,
        toolCall: { name: "throw", arguments: {} }
      },
      { text: "recovered", done: true }
    ]);

    const result = await runAgentLoop({
      llmClient: client,
      toolRegistry: registry,
      maxSteps: 3,
      systemPrompt: "system",
      task: "task"
    });

    expect(result.stopReason).toBe("done");
    expect(result.messages.some((m) => m.role === "tool" && m.content.includes("Tool throw failed"))).toBe(true);
    expect(result.messages.some((m) => m.role === "tool" && m.content.includes("boom"))).toBe(true);
  });
});
