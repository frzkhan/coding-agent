import type { ModelMessage } from "ai";
import { LlmError } from "../../errors.js";
import type { ChatMessage, LlmResponse, TokenUsage } from "../client.js";
import { parseAgentOutput } from "../parseAgentOutput.js";

export function toModelMessages(messages: ChatMessage[]): ModelMessage[] {
  return messages.map((message) => ({
    role: message.role === "tool" ? "user" : message.role,
    content: message.role === "tool" ? `[tool]\n${message.content}` : message.content
  }));
}

export function parseTextResponse(text: string, providerName: string, usage?: TokenUsage): LlmResponse {
  try {
    const parsed = parseAgentOutput(text.trim());
    return {
      text: parsed.done ? parsed.final : parsed.thought,
      done: parsed.done,
      toolCall: parsed.toolCall,
      usage
    };
  } catch (error) {
    if (error instanceof LlmError) {
      const sample = text.slice(0, 400).replace(/\s+/g, " ").trim();
      throw new LlmError(`${providerName} returned invalid agent JSON: ${error.message} Raw output: ${sample}`);
    }
    throw error;
  }
}
