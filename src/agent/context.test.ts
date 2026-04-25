import { describe, expect, it } from "vitest";
import { compactMessagesToBudget, countMessageTokens, estimateTokens } from "./context.js";
import type { ChatMessage } from "../llm/client.js";

describe("context budget helpers", () => {
  it("estimates and counts tokens", () => {
    expect(estimateTokens("12345678")).toBe(2);
    expect(countMessageTokens([{ role: "user", content: "hello" }])).toBeGreaterThan(0);
  });

  it("compacts older history when over budget", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "system" },
      ...Array.from({ length: 12 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as ChatMessage["role"],
        content: `message ${i} ${"x".repeat(800)}`
      }))
    ];

    const result = compactMessagesToBudget(messages, 2500, 500);

    expect(result.compacted).toBe(true);
    expect(result.messages[0].role).toBe("system");
    expect(result.messages[1].content).toContain("[conversation summary]");
    expect(result.messages.length).toBeLessThan(messages.length);
  });
});
