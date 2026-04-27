import { describe, expect, it } from "vitest";
import { LlmError } from "../errors.js";
import { parseAgentOutput } from "./parseAgentOutput.js";

describe("parseAgentOutput", () => {
  it("parses strict JSON output", () => {
    const output = parseAgentOutput(
      '{"thought":"use tool","done":false,"final":"","toolCall":{"name":"glob","arguments":{"pattern":"src/**/*.ts"}}}'
    );

    expect(output.done).toBe(false);
    expect(output.toolCall?.name).toBe("glob");
  });

  it("parses tsDiagnostics tool calls", () => {
    const output = parseAgentOutput(
      '{"thought":"check","done":false,"final":"","toolCall":{"name":"tsDiagnostics","arguments":{"path":"src/cli.ts"}}}'
    );
    expect(output.toolCall?.name).toBe("tsDiagnostics");
    expect(output.toolCall?.arguments).toEqual({ path: "src/cli.ts" });
  });

  it("rejects tool calls that omit required arguments", () => {
    expect(() =>
      parseAgentOutput('{"thought":"searching","done":false,"final":"","toolCall":{"name":"search","arguments":{}}}')
    ).toThrow(LlmError);
  });

  it("parses search with allWords only", () => {
    const output = parseAgentOutput(
      '{"thought":"s","done":false,"final":"","toolCall":{"name":"search","arguments":{"allWords":"progress step maxSteps","include":"src/**/*.ts"}}}'
    );
    expect(output.toolCall?.name).toBe("search");
    expect(output.toolCall?.arguments).toMatchObject({
      allWords: "progress step maxSteps",
      include: "src/**/*.ts"
    });
  });

  it("parses JSON wrapped in markdown fences", () => {
    const output = parseAgentOutput(
      '```json\n{"thought":"done","done":true,"final":"finished"}\n```'
    );

    expect(output.done).toBe(true);
    expect(output.final).toBe("finished");
  });

  it("throws on non-JSON output", () => {
    expect(() => parseAgentOutput("I think we should continue")).toThrow(LlmError);
  });

  it("parses JSON when a string value contains a closing brace", () => {
    const output = parseAgentOutput(
      '{"thought":"brace } here","done":true,"final":"ok with } char"}'
    );
    expect(output.done).toBe(true);
    expect(output.final).toBe("ok with } char");
  });

  it("coerces string done and stringified tool arguments", () => {
    const output = parseAgentOutput(
      '{"thought":"t","done":"false","final":"","toolCall":{"name":"glob","arguments":"{\\"pattern\\":\\"*.ts\\"}"}}'
    );
    expect(output.done).toBe(false);
    expect(output.toolCall?.arguments).toEqual({ pattern: "*.ts" });
  });

  it("infers done true when final is set and done is omitted", () => {
    const output = parseAgentOutput('{"thought":"bye","final":"All set."}');
    expect(output.done).toBe(true);
    expect(output.final).toBe("All set.");
  });

  it("drops an empty toolCall alongside a done final answer", () => {
    const output = parseAgentOutput(
      '{"thought":"t","done":true,"final":"No git tools exist here.","toolCall":{}}'
    );
    expect(output.done).toBe(true);
    expect(output.final).toBe("No git tools exist here.");
    expect(output.toolCall).toBeUndefined();
  });

  it("drops a toolCall without a valid name", () => {
    const output = parseAgentOutput(
      '{"thought":"t","done":true,"final":"Answer.","toolCall":{"name":"","arguments":{}}}'
    );
    expect(output.done).toBe(true);
    expect(output.toolCall).toBeUndefined();
  });
});
