import { z } from "zod";
import { LlmError } from "../errors.js";

const agentOutputSchema = z.object({
  thought: z.coerce.string().default(""),
  done: z.boolean(),
  final: z.coerce.string().default(""),
  toolCall: z
    .object({
      name: z.string(),
      arguments: z.record(z.string(), z.unknown()).default({})
    })
    .optional()
});

export type AgentOutput = z.infer<typeof agentOutputSchema>;

/** First top-level `{ ... }` slice, respecting strings so `}` inside values does not truncate. */
function extractBalancedJsonObject(text: string, fromIndex: number): string | null {
  const start = text.indexOf("{", fromIndex);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") {
      depth += 1;
      continue;
    }
    if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new LlmError("Model returned empty output.");
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fencedMatch?.[1]?.trim() ?? trimmed;

  let slice = extractBalancedJsonObject(candidate, 0);
  if (!slice) {
    slice = extractBalancedJsonObject(trimmed, 0);
  }
  if (!slice) {
    throw new LlmError("Model output is not valid JSON for agent contract.");
  }

  return slice;
}

function normalizeParsedAgentJson(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return raw;
  }
  const o = { ...(raw as Record<string, unknown>) };

  if (typeof o.done === "string") {
    o.done = o.done.toLowerCase() === "true" || o.done === "1";
  }
  if (typeof o.done === "number") {
    o.done = o.done !== 0;
  }

  if (o.toolCall !== undefined && o.toolCall !== null && typeof o.toolCall === "object") {
    const tc = { ...(o.toolCall as Record<string, unknown>) };
    const args = tc.arguments;
    if (typeof args === "string") {
      try {
        tc.arguments = JSON.parse(args) as unknown;
      } catch {
        tc.arguments = {};
      }
    } else if (args === undefined || args === null) {
      tc.arguments = {};
    } else if (Array.isArray(args)) {
      tc.arguments = {};
    } else if (typeof args !== "object") {
      tc.arguments = {};
    }
    o.toolCall = tc;
  }

  if (o.done === undefined) {
    const hasFinal = typeof o.final === "string" && o.final.trim().length > 0;
    const hasTool = o.toolCall !== undefined && o.toolCall !== null;
    if (hasFinal && !hasTool) {
      o.done = true;
    } else {
      o.done = false;
    }
  }

  return o;
}

export function parseAgentOutput(text: string): AgentOutput {
  const jsonString = extractJsonObject(text);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonString);
  } catch {
    throw new LlmError("Model output is not valid JSON for agent contract.");
  }

  let parsed = agentOutputSchema.safeParse(parsedJson);
  if (!parsed.success) {
    parsed = agentOutputSchema.safeParse(normalizeParsedAgentJson(parsedJson));
  }
  if (!parsed.success) {
    throw new LlmError("Model output is not valid JSON for agent contract.");
  }

  return parsed.data;
}
