import { describe, expect, it } from "vitest";
import { tryRecoverAgentResponse } from "./aiSdk.js";
describe("tryRecoverAgentResponse", () => {
    it("returns null for empty or missing raw text", () => {
        expect(tryRecoverAgentResponse(undefined, undefined)).toBeNull();
        expect(tryRecoverAgentResponse("", undefined)).toBeNull();
        expect(tryRecoverAgentResponse("   \n  ", undefined)).toBeNull();
    });
    it("returns null when the raw text cannot be parsed as agent JSON", () => {
        expect(tryRecoverAgentResponse("Thinking: Let me search the code.", undefined)).toBeNull();
        expect(tryRecoverAgentResponse("just some freeform prose", undefined)).toBeNull();
    });
    it("recovers a tool call when the model forgot the required done field", () => {
        const rawText = JSON.stringify({
            toolCall: {
                name: "search",
                arguments: { pattern: "countMessageTokens|estimateTokens", include: "src/**/*.ts" }
            }
        });
        const recovered = tryRecoverAgentResponse(rawText, undefined);
        expect(recovered).not.toBeNull();
        expect(recovered?.done).toBe(false);
        expect(recovered?.toolCall).toEqual({
            name: "search",
            arguments: { pattern: "countMessageTokens|estimateTokens", include: "src/**/*.ts" }
        });
    });
    it("recovers a final answer when the model emitted only final + implicit done", () => {
        const rawText = JSON.stringify({ final: "Token counts live in loop.ts responseUsage." });
        const recovered = tryRecoverAgentResponse(rawText, undefined);
        expect(recovered).not.toBeNull();
        expect(recovered?.done).toBe(true);
        expect(recovered?.text).toBe("Token counts live in loop.ts responseUsage.");
        expect(recovered?.toolCall).toBeUndefined();
    });
    it("recovers a done response when the model leaves an empty toolCall alongside final", () => {
        const rawText = JSON.stringify({
            thought: "no git tools here",
            done: true,
            final: "No git integration tools exist in this repo.",
            toolCall: {}
        });
        const recovered = tryRecoverAgentResponse(rawText, undefined);
        expect(recovered).not.toBeNull();
        expect(recovered?.done).toBe(true);
        expect(recovered?.text).toBe("No git integration tools exist in this repo.");
        expect(recovered?.toolCall).toBeUndefined();
    });
    it("passes through provider usage when available", () => {
        const rawText = JSON.stringify({ toolCall: { name: "readFile", arguments: { path: "src/cli.ts" } } });
        const recovered = tryRecoverAgentResponse(rawText, {
            inputTokens: 100,
            outputTokens: 20,
            totalTokens: 120
        });
        expect(recovered?.usage).toEqual({
            inputTokens: 100,
            outputTokens: 20,
            totalTokens: 120,
            source: "provider"
        });
    });
});
