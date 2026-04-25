import type { ModelMessage } from "ai";
import { LlmError } from "../../errors.js";
import type { ChatMessage, LlmResponse, TokenUsage } from "../client.js";
import { parseAgentOutput } from "../parseAgentOutput.js";

// The function only consumes the numeric token fields, so we accept any
// structural shape that carries them. This decouples us from the exact
// `LanguageModelUsage` type, which has changed incompatibly between ai-sdk
// minor versions (e.g. v5 vs v6 added `inputTokenDetails` / `outputTokenDetails`).
export type ProviderUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

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

// Some providers/models (notably Ollama qwen3 variants) fail the strict
// `generateObject` schema check while still emitting a nearly-correct JSON
// agent response (e.g. missing `done`, done as a string, arguments as a
// string, etc.). Our `parseAgentOutput` already normalizes these shapes, so
// try it before giving up.
export function tryRecoverAgentResponse(
  rawText: string | undefined,
  usage: ProviderUsage | undefined
): LlmResponse | null {
  if (!rawText || !rawText.trim()) return null;
  try {
    const parsed = parseAgentOutput(rawText.trim());
    return {
      text: parsed.done ? parsed.final : parsed.thought,
      done: parsed.done,
      toolCall: parsed.toolCall,
      usage: usage
        ? {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
            source: "provider"
          }
        : undefined
    };
  } catch {
    return null;
  }
}
