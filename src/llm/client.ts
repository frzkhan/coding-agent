export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

export type ToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

export type LlmResponse = {
  text: string;
  toolCall?: ToolCall;
  done: boolean;
  usage?: TokenUsage;
};

export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  source: "provider" | "estimated";
};

export type LlmGenerateOptions = {
  onChunk?: (chunk: string) => void;
};

export interface LlmClient {
  generate(messages: ChatMessage[], options?: LlmGenerateOptions): Promise<LlmResponse>;
}
