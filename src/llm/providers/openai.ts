import { openai } from "@ai-sdk/openai";
import { streamText, type LanguageModelUsage } from "ai";
import { LlmError } from "../../errors.js";
import type { ChatMessage, LlmClient, LlmGenerateOptions, LlmResponse, TokenUsage } from "../client.js";
import { parseTextResponse, toModelMessages } from "./aiSdk.js";

function toTokenUsage(usage: LanguageModelUsage): TokenUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    source: "provider"
  };
}

export class OpenAiClient implements LlmClient {
  private readonly model: string;
  private readonly temperature: number;

  constructor(params: { model: string; temperature: number }) {
    this.model = params.model;
    this.temperature = params.temperature;
  }

  async generate(messages: ChatMessage[], options: LlmGenerateOptions = {}): Promise<LlmResponse> {
    try {
      const response = streamText({
        model: openai(this.model),
        temperature: this.temperature,
        messages: toModelMessages(messages)
      });

      let text = "";
      for await (const chunk of response.textStream) {
        text += chunk;
        options.onChunk?.(chunk);
      }

      return parseTextResponse(text, "OpenAI", toTokenUsage(await response.usage));
    } catch (error) {
      if (error instanceof LlmError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new LlmError(`OpenAI request failed: ${message}`);
    }
  }
}
