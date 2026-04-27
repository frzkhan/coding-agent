import dotenv from "dotenv";
import { z } from "zod";
import { ConfigError } from "./errors.js";
dotenv.config();
const configSchema = z.object({
    PROVIDER: z.enum(["openai", "ollama"]).default("openai"),
    OPENAI_API_KEY: z.string().optional(),
    MODEL: z.string().min(1).default("gpt-4.1-mini"),
    TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
    MAX_STEPS: z.coerce.number().int().min(1).max(50).default(8),
    CONTEXT_TOKEN_LIMIT: z.coerce.number().int().min(2000).max(200000).default(24000),
    SHELL_ALLOWLIST: z.string().default("ls,pwd,rg,npm test,npx tsc"),
    SHELL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(12000),
    /**
     * After each successful writeFile/str_replace, run this shell command from the workspace root
     * (e.g. `npx tsc --noEmit --incremental`, `ruff check .`). Empty = no auto verify; the model must
     * run checks via the shell tool.
     */
    POST_EDIT_VERIFY: z.string().default(""),
    OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434")
});
export function loadConfig(env = process.env) {
    const parsed = configSchema.safeParse(env);
    if (!parsed.success) {
        const details = parsed.error.issues.map((issue) => issue.message).join("; ");
        throw new ConfigError(`Invalid configuration: ${details}`);
    }
    if (parsed.data.PROVIDER === "openai" && !parsed.data.OPENAI_API_KEY?.trim()) {
        throw new ConfigError("Invalid configuration: OPENAI_API_KEY is required for PROVIDER=openai");
    }
    return {
        provider: parsed.data.PROVIDER,
        openAiApiKey: parsed.data.OPENAI_API_KEY,
        model: parsed.data.MODEL,
        temperature: parsed.data.TEMPERATURE,
        maxSteps: parsed.data.MAX_STEPS,
        contextTokenLimit: parsed.data.CONTEXT_TOKEN_LIMIT,
        shellAllowlist: parsed.data.SHELL_ALLOWLIST.split(",")
            .map((entry) => entry.trim())
            .filter(Boolean),
        shellTimeoutMs: parsed.data.SHELL_TIMEOUT_MS,
        postEditVerifyCommand: parsed.data.POST_EDIT_VERIFY.trim(),
        ollamaBaseUrl: parsed.data.OLLAMA_BASE_URL
    };
}
