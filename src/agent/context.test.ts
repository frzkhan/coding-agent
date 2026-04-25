import { describe, expect, it } from "vitest";
import { compactMessagesToBudget, countMessageTokens, estimateTokens } from "./context.js";
import type { ChatMessage } from "../llm/client.js";

describe("context budget helpers", () => {
  it("estimates tokens via the real tokenizer", () => {
    expect(estimateTokens("")).toBe(0);
    // "hello world" is 2 BPE tokens in cl100k_base and the char/4 fallback
    // would say 3; assert on the real value so we catch regressions.
    expect(estimateTokens("hello world")).toBe(2);
    // For short ASCII text the tokenizer should never exceed char count.
    const text = "const x = 1;";
    expect(estimateTokens(text)).toBeGreaterThan(0);
    expect(estimateTokens(text)).toBeLessThanOrEqual(text.length);
  });

  it("counts tokens across all messages", () => {
    const total = countMessageTokens([
      { role: "user", content: "hello world" },
      { role: "assistant", content: "goodbye" }
    ]);
    expect(total).toBeGreaterThan(0);
  });

  it("compacts older history when over budget", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "system" },
      ...Array.from({ length: 20 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as ChatMessage["role"],
        content: `message ${i} ${"varied content ".repeat(80)}`
      }))
    ];

    const result = compactMessagesToBudget(messages, 2000, 500);

    expect(result.compacted).toBe(true);
    expect(result.messages[0].role).toBe("system");
    expect(result.messages[1].content).toContain("[conversation summary]");
    expect(result.messages.length).toBeLessThan(messages.length);
    expect(result.afterTokens).toBeLessThan(result.beforeTokens);
  });
});
