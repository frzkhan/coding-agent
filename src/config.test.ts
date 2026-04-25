import { describe, expect, it } from "vitest";
import { ConfigError } from "./errors.js";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("loads defaults and parses allowlist", () => {
    const config = loadConfig({
      PROVIDER: "openai",
      OPENAI_API_KEY: "test_key",
      SHELL_ALLOWLIST: "ls,pwd"
    });

    expect(config.provider).toBe("openai");
    expect(config.model).toBe("gpt-4.1-mini");
    expect(config.maxSteps).toBe(8);
    expect(config.contextTokenLimit).toBe(24000);
    expect(config.shellAllowlist).toEqual(["ls", "pwd"]);
  });

  it("throws when OpenAI key is missing for openai provider", () => {
    expect(() => loadConfig({ PROVIDER: "openai" })).toThrow(ConfigError);
  });

  it("allows missing OpenAI key for ollama provider", () => {
    const config = loadConfig({
      PROVIDER: "ollama",
      MODEL: "qwen2.5-coder:7b"
    });

    expect(config.provider).toBe("ollama");
    expect(config.openAiApiKey).toBeUndefined();
  });
});
