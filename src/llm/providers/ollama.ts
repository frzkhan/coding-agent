import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
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

export class OllamaClient implements LlmClient {
  private readonly model: string;
  private readonly temperature: number;
  private readonly provider: ReturnType<typeof createOpenAICompatible>;

  constructor(params: { model: string; temperature: number; baseUrl: string }) {
    this.model = params.model;
    this.temperature = params.temperature;
    this.provider = createOpenAICompatible({
      name: "ollama",
      baseURL: `${params.baseUrl.replace(/\/$/, "")}/v1`,
      // Ollama maps strict json_schema to grammar decoding; many models (e.g. qwen3)
      // error with "failed to load model vocabulary required for format". json_object
      // works; generateObject still guides the model and we recover via parseAgentOutput.
      supportsStructuredOutputs: false
    });
  }

  async generate(messages: ChatMessage[], _options: LlmGenerateOptions = {}): Promise<LlmResponse> {
    try {
      const response = await generateObject({
        model: this.provider(this.model),
        temperature: this.temperature,
        messages: toModelMessages(messages),
        schema: agentOutputSchema,
        schemaName: "AgentOutput",
        schemaDescription:
          "Controller response for a coding agent. If done is false and toolCall is present, toolCall.arguments must include every required argument for the selected tool. For search, provide arguments.pattern and/or arguments.allWords."
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
      throw new LlmError(`Ollama request failed: ${message}`, {
        rawText
      });
    }
  }
}
