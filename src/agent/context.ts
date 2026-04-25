import { countTokens as gptCountTokens } from "gpt-tokenizer";
import type { ChatMessage } from "../llm/client.js";

const SUMMARY_MAX_CHARS = 240;

export type ContextBudgetResult = {
  messages: ChatMessage[];
  beforeTokens: number;
  afterTokens: number;
  compacted: boolean;
};

// Tokenizer is a close approximation for OpenAI/GPT models (cl100k_base by default
// in gpt-tokenizer@3). For other model families (qwen, llama, etc.) the count
// may differ but is still far more accurate than a flat char/4 heuristic and
// is only used as a fallback when the provider does not report real usage.
export function estimateTokens(text: string): number {
  if (!text) return 0;
  try {
    return gptCountTokens(text);
  } catch {
    return Math.ceil(text.length / 4);
  }
}

export function countMessageTokens(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => total + estimateTokens(message.role) + estimateTokens(message.content), 0);
}

function summarizeMessage(message: ChatMessage): string {
  const normalized = message.content.replace(/\s+/g, " ").trim();
  const preview =
    normalized.length > SUMMARY_MAX_CHARS ? `${normalized.slice(0, SUMMARY_MAX_CHARS - 3)}...` : normalized;
  return `- ${message.role}: ${preview}`;
}

function buildCompactionMessage(removed: ChatMessage[]): ChatMessage {
  return {
    role: "user",
    content: [
      "[conversation summary]",
      "Older messages were compacted to stay within the context budget. Preserve their intent where relevant:",
      ...removed.map(summarizeMessage)
    ].join("\n")
  };
}

export function compactMessagesToBudget(
  messages: ChatMessage[],
  maxTokens: number,
  reserveTokens = 4000
): ContextBudgetResult {
  const beforeTokens = countMessageTokens(messages);
  const targetTokens = Math.max(1000, maxTokens - reserveTokens);
  if (beforeTokens <= targetTokens || messages.length <= 3) {
    return { messages, beforeTokens, afterTokens: beforeTokens, compacted: false };
  }

  const [systemMessage, ...rest] = messages;
  const kept: ChatMessage[] = [];
  let keptTokens = countMessageTokens([systemMessage]);

  for (let i = rest.length - 1; i >= 0; i -= 1) {
    const message = rest[i];
    const nextTokens = keptTokens + countMessageTokens([message]);
    if (nextTokens > Math.floor(targetTokens * 0.7) && kept.length >= 4) break;
    kept.unshift(message);
    keptTokens = nextTokens;
  }

  const removed = rest.slice(0, rest.length - kept.length);
  const compactedMessages = [systemMessage, buildCompactionMessage(removed), ...kept];
  const afterTokens = countMessageTokens(compactedMessages);
  return {
    messages: compactedMessages,
    beforeTokens,
    afterTokens,
    compacted: true
  };
}
