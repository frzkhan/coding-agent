import { describe, expect, it } from "vitest";
import { runAgentLoop } from "./loop.js";
import { LlmError } from "../errors.js";
import { ToolRegistry } from "../tools/types.js";
class SequenceClient {
    responses;
    index = 0;
    constructor(responses) {
        this.responses = responses;
    }
    async generate(_messages, _options = {}) {
        const response = this.responses[this.index];
        this.index += 1;
        return response;
    }
}
class ErrorThenDoneClient {
    calls = 0;
    async generate() {
        this.calls += 1;
        if (this.calls === 1) {
            throw new LlmError("Ollama request failed: No object generated: could not parse the response.");
        }
        return { text: "recovered", done: true };
    }
}
class RawTextErrorClient {
    async generate(_messages, _options = {}) {
        throw new LlmError("Ollama request failed: No object generated: could not parse the response.", {
            rawText: "The label values are used only as optional location prefixes."
        });
    }
}
class EchoTool {
    name = "echo";
    async run(args) {
        return { ok: true, output: `echo:${String(args.value ?? "")}` };
    }
}
class ThrowTool {
    name = "throw";
    async run() {
        throw new Error("boom");
    }
}
class MutatingTool {
    name = "str_replace";
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
        const updates = [];
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
    it("retries when the model returns invalid agent JSON", async () => {
        const registry = new ToolRegistry();
        const updates = [];
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
        const updates = [];
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
        const updates = [];
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
        const existingMessages = [
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
