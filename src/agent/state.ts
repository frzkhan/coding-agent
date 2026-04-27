import type { ChatMessage } from "../llm/client.js";

export type AgentStopReason = "done" | "blocked" | "max_steps_reached";

export type AgentTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  source: "provider" | "estimated" | "mixed";
};

export type AgentResult = {
  stopReason: AgentStopReason;

  finalResponse: string;
  messages: ChatMessage[];
  tokenUsage: AgentTokenUsage;
};
