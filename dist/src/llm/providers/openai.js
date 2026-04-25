import { openai } from "@ai-sdk/openai";
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
export class OpenAiClient {
    model;
    temperature;
    constructor(params) {
        this.model = params.model;
        this.temperature = params.temperature;
    }
    async generate(messages, options = {}) {
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
        }
        catch (error) {
            if (error instanceof LlmError) {
                throw error;
            }
            const message = error instanceof Error ? error.message : String(error);
            throw new LlmError(`OpenAI request failed: ${message}`);
        }
    }
}
