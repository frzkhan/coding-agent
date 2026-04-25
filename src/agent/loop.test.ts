import { describe, expect, it } from "vitest";
import { looksLikeContinuation, looksLikeErrorPaste, runAgentLoop, taskRequestsWorkspaceChange } from "./loop.js";
import { LlmError } from "../errors.js";
import type { ChatMessage, LlmClient, LlmGenerateOptions, LlmResponse } from "../llm/client.js";
import { ToolRegistry, type Tool } from "../tools/types.js";

class SequenceClient implements LlmClient {
  private index = 0;

  constructor(private readonly responses: LlmResponse[]) {}

  async generate(_messages: ChatMessage[], _options: LlmGenerateOptions = {}): Promise<LlmResponse> {
    const response = this.responses[this.index];
    this.index += 1;
    return response;
  }
}

class ErrorThenDoneClient implements LlmClient {
  private calls = 0;

  async generate(): Promise<LlmResponse> {
    this.calls += 1;
    if (this.calls === 1) {
      throw new LlmError("Ollama request failed: No object generated: could not parse the response.");
    }
    return { text: "recovered", done: true };
  }
}

class RawTextErrorClient implements LlmClient {
  async generate(_messages: ChatMessage[], _options: LlmGenerateOptions = {}): Promise<never> {
    throw new LlmError("Ollama request failed: No object generated: could not parse the response.", {
      rawText: "The label values are used only as optional location prefixes."
    });
  }
}

class PlanTextErrorClient implements LlmClient {
  constructor(private readonly rawText: string) {}

  async generate(_messages: ChatMessage[], _options: LlmGenerateOptions = {}): Promise<never> {
    throw new LlmError("Ollama request failed: No object generated: could not parse the response.", {
      rawText: this.rawText
    });
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
    const client: LlmClient = new SequenceClient([
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
    const client: LlmClient = new SequenceClient([
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
    const client: LlmClient = new SequenceClient([
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

  it("retries when the model returns invalid agent JSON", async () => {
    const registry = new ToolRegistry();
    const updates: string[] = [];
    const client = new ErrorThenDoneClient();

    const result = await runAgentLoop({
      llmClient: client,
      toolRegistry: registry,
      maxSteps: 2,
      systemPrompt: "system",
      task: "answer",
      onStep: (_step, info) => updates.push(info)
    });

    expect(result.stopReason).toBe("done");
    expect(result.finalResponse).toBe("recovered");
    expect(updates.some((info) => info.startsWith("Model output invalid:"))).toBe(true);
    expect(result.messages.some((message) => message.content.includes("Return exactly one valid JSON object"))).toBe(true);
  });

  it("uses raw invalid model text as a final answer for read-only tasks after tool evidence", async () => {
    const registry = new ToolRegistry();
    registry.register(new EchoTool());
    const updates: string[] = [];
    const client = new SequenceClient([
      {
        text: "checking",
        done: false,
        toolCall: { name: "echo", arguments: { value: "tool evidence" } }
      }
    ]);

    const result = await runAgentLoop({
      llmClient: {
        generate: async (messages, options) => {
          if (messages.some((message) => message.role === "tool")) {
            return new RawTextErrorClient().generate(messages, options);
          }
          return client.generate(messages, options);
        }
      },
      toolRegistry: registry,
      maxSteps: 2,
      systemPrompt: "system",
      task: "what labels are we using",
      onStep: (_step, info) => updates.push(info)
    });

    expect(result.stopReason).toBe("done");
    expect(result.finalResponse).toContain("label values");
    expect(updates.some((info) => info.startsWith("Using raw model answer"))).toBe(true);
  });

  it("does not accept a planning-style raw model answer as a final answer", async () => {
    const registry = new ToolRegistry();
    registry.register(new EchoTool());
    const updates: string[] = [];
    const toolCallClient = new SequenceClient([
      {
        text: "checking",
        done: false,
        toolCall: { name: "echo", arguments: { value: "tool evidence" } }
      }
    ]);
    const planClient = new PlanTextErrorClient(
      "Thinking: I found references to token calculation. Let me search for the actual token counting functions."
    );

    const result = await runAgentLoop({
      llmClient: {
        generate: async (messages, options) => {
          if (messages.some((message) => message.role === "tool")) {
            return planClient.generate(messages, options);
          }
          return toolCallClient.generate(messages, options);
        }
      },
      toolRegistry: registry,
      maxSteps: 3,
      systemPrompt: "system",
      task: "how does token calculation work",
      onStep: (_step, info) => updates.push(info)
    });

    expect(result.stopReason).toBe("max_steps_reached");
    expect(updates.some((info) => info.startsWith("Using raw model answer"))).toBe(false);
    expect(
      updates.some((info) => info.startsWith("Model output invalid (raw looked like a plan"))
    ).toBe(true);
  });

  it("does not use raw invalid model text as a final answer for edit tasks", async () => {
    const registry = new ToolRegistry();
    registry.register(new EchoTool());
    const client = new SequenceClient([
      {
        text: "checking",
        done: false,
        toolCall: { name: "echo", arguments: { value: "tool evidence" } }
      }
    ]);

    const result = await runAgentLoop({
      llmClient: {
        generate: async (messages, options) => {
          if (messages.some((message) => message.role === "tool")) {
            return new RawTextErrorClient().generate(messages, options);
          }
          return client.generate(messages, options);
        }
      },
      toolRegistry: registry,
      maxSteps: 2,
      systemPrompt: "system",
      task: "update labels",
    });

    expect(result.stopReason).toBe("max_steps_reached");
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

describe("looksLikeErrorPaste", () => {
  it("detects named JS errors with a colon", () => {
    expect(looksLikeErrorPaste("TypeError: callback is not a function")).toBe(true);
    expect(looksLikeErrorPaste("ReferenceError: foo is not defined")).toBe(true);
    expect(looksLikeErrorPaste("SyntaxError: Unexpected token ')'")).toBe(true);
  });

  it("detects JS stack frames", () => {
    expect(looksLikeErrorPaste("    at runChatSession (/path/cli.ts:308:19)")).toBe(true);
    expect(looksLikeErrorPaste("at Object.<anonymous> (src/cli.ts:312:5)")).toBe(true);
  });

  it("detects Python tracebacks", () => {
    expect(looksLikeErrorPaste("Traceback (most recent call last):")).toBe(true);
    expect(looksLikeErrorPaste('  File "main.py", line 42, in <module>')).toBe(true);
  });

  it("does not flag prose that merely mentions error words", () => {
    expect(looksLikeErrorPaste("How should I handle the Error object in JS?")).toBe(false);
    expect(looksLikeErrorPaste("add error handling to the cli")).toBe(false);
    expect(looksLikeErrorPaste("")).toBe(false);
  });
});

describe("taskRequestsWorkspaceChange", () => {
  it("returns true for imperative change verbs", () => {
    expect(taskRequestsWorkspaceChange("fix the bug in loop.ts")).toBe(true);
    expect(taskRequestsWorkspaceChange("Update the CLI output")).toBe(true);
    expect(taskRequestsWorkspaceChange("refactor the completer")).toBe(true);
  });

  it("returns true for error pastes with no imperative", () => {
    expect(
      taskRequestsWorkspaceChange(
        "Tab completion error: TypeError: callback is not a function\n    at /path/cli.ts:312:5"
      )
    ).toBe(true);
  });

  it("returns false for plain questions", () => {
    expect(taskRequestsWorkspaceChange("what does this function do?")).toBe(false);
    expect(taskRequestsWorkspaceChange("explain the token counting")).toBe(false);
    expect(taskRequestsWorkspaceChange(undefined)).toBe(false);
  });
});

describe("looksLikeContinuation", () => {
  it("detects Thinking:/Thought: prefixes", () => {
    expect(looksLikeContinuation("Thinking: I found the token calculation implementation.")).toBe(true);
    expect(looksLikeContinuation("Thought: need to search for definitions.")).toBe(true);
  });

  it("detects planned next actions", () => {
    expect(
      looksLikeContinuation("I found references to token calculation. Let me search for the actual token counting functions.")
    ).toBe(true);
    expect(looksLikeContinuation("I'll read the context.ts file to confirm my understanding.")).toBe(true);
    expect(looksLikeContinuation("I need to check the other tool implementations.")).toBe(true);
    expect(looksLikeContinuation("Next, I'll verify this by searching the tests.")).toBe(true);
  });

  it("does not flag concrete answers", () => {
    expect(
      looksLikeContinuation("The label values are used only as optional location prefixes.")
    ).toBe(false);
    expect(
      looksLikeContinuation("Token counts come from responseUsage in loop.ts, which falls back to estimateTokens.")
    ).toBe(false);
    expect(looksLikeContinuation("")).toBe(false);
  });
});
