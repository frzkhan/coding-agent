import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import { LlmError } from "../../errors.js";
import { parseTextResponse, toModelMessages } from "./aiSdk.js";
function toTokenUsage(usage) {
    return {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        source: "provider"
    };
}
export class OllamaClient {
    model;
    temperature;
    provider;
    constructor(params) {
        this.model = params.model;
        this.temperature = params.temperature;
        this.provider = createOpenAICompatible({
            name: "ollama",
            baseURL: `${params.baseUrl.replace(/\/$/, "")}/v1`
        });
    }
    async generate(messages, options = {}) {
        try {
            const response = streamText({
                model: this.provider(this.model),
                temperature: this.temperature,
                messages: toModelMessages(messages)
            });
            let text = "";
            for await (const chunk of response.textStream) {
                text += chunk;
                options.onChunk?.(chunk);
            }
            return parseTextResponse(text, "Ollama", toTokenUsage(await response.usage));
        }
        catch (error) {
            if (error instanceof LlmError) {
                throw error;
            }
            const message = error instanceof Error ? error.message : String(error);
            throw new LlmError(`Ollama request failed: ${message}`);
        }
    }
}
