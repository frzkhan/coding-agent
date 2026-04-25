import { openai } from "@ai-sdk/openai";
import { generateObject, NoObjectGeneratedError, type LanguageModelUsage } from "ai";
import { LlmError } from "../../errors.js";
import type { ChatMessage, LlmClient, LlmGenerateOptions, LlmResponse, TokenUsage } from "../client.js";
import { agentOutputSchema } from "../parseAgentOutput.js";
import { toModelMessages, tryRecoverAgentResponse } from "./aiSdk.js";

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

  async generate(messages: ChatMessage[], _options: LlmGenerateOptions = {}): Promise<LlmResponse> {
    try {
      const response = await generateObject({
        model: openai(this.model),
        temperature: this.temperature,
        messages: toModelMessages(messages),
        schema: agentOutputSchema,
        schemaName: "AgentOutput",
        schemaDescription:
          "Controller response for a coding agent. If done is false and toolCall is present, toolCall.arguments must include every required argument for the selected tool. For search, provide arguments.pattern."
      });

      return {
        text: response.object.done ? response.object.final : response.object.thought,
        done: response.object.done,
        toolCall: response.object.toolCall,
        usage: toTokenUsage(response.usage)
      };
    } catch (error) {
      if (error instanceof LlmError) {
        throw error;
      }
      const rawText = NoObjectGeneratedError.isInstance(error) ? error.text : undefined;
      const errorUsage = NoObjectGeneratedError.isInstance(error) ? error.usage : undefined;
      const recovered = tryRecoverAgentResponse(rawText, errorUsage);
      if (recovered) {
        return recovered;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new LlmError(`OpenAI request failed: ${message}`, {
        rawText
      });
    }
  }
}
