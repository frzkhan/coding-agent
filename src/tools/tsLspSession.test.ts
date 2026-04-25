import { describe, expect, it } from "vitest";
import {
  flattenLocations,
  formatDiagnostics,
  formatHoverContents,
  formatLocation,
  pathToDocumentUri
} from "./tsLspSession.js";

describe("flattenLocations", () => {
  it("normalizes a single Location", () => {
    const loc = {
      uri: "file:///x/a.ts",
      range: {
        start: { line: 1, character: 2 },
        end: { line: 1, character: 5 }
      }
    };
    expect(flattenLocations(loc)).toEqual([loc]);
  });

  it("normalizes LocationLink", () => {
    const raw = {
      targetUri: "file:///x/b.ts",
      targetRange: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 }
      },
      targetSelectionRange: {
        start: { line: 2, character: 3 },
        end: { line: 2, character: 4 }
      }
    };
    expect(flattenLocations(raw)).toEqual([
      {
        uri: "file:///x/b.ts",
        range: raw.targetSelectionRange
      }
    ]);
  });
});

describe("formatLocation", () => {
  it("prints 1-based line", () => {
    const line = formatLocation({
      uri: pathToDocumentUri("/tmp/example.ts"),
      range: {
        start: { line: 3, character: 0 },
        end: { line: 3, character: 1 }
      }
    });
    expect(line).toContain(":4:0");
  });
});

describe("formatDiagnostics", () => {
  it("returns a clean message when there are no diagnostics", () => {
    expect(formatDiagnostics("src/a.ts", [])).toContain("No TypeScript errors");
  });

  it("prints path:line:col severity code: message", () => {
    const out = formatDiagnostics("src/a.ts", [
      {
        range: {
          start: { line: 11, character: 4 },
          end: { line: 11, character: 20 }
        },
        severity: 1,
        code: 2339,
        message: "Property 'setCompletion' does not exist on type 'Interface'."
      }
    ]);
    expect(out).toContain("src/a.ts:12:4 error 2339:");
    expect(out).toContain("'setCompletion'");
  });

  it("labels severity 2 as warning and severity 4 as hint", () => {
    const warn = formatDiagnostics("a.ts", [
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 2, message: "w" }
    ]);
    const hint = formatDiagnostics("a.ts", [
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 4, message: "h" }
    ]);
    expect(warn).toContain("warning");
    expect(hint).toContain("hint");
  });
});

describe("formatHoverContents", () => {
  it("extracts value from MarkupContent", () => {
    const out = formatHoverContents({ contents: { kind: "markdown", value: "```ts\nconst rl: Interface\n```" } });
    expect(out).toContain("const rl: Interface");
  });

  it("joins an array of marked strings", () => {
    const out = formatHoverContents({
      contents: [{ language: "typescript", value: "function foo(): void" }, "foo does a thing"]
    });
    expect(out).toContain("function foo(): void");
    expect(out).toContain("foo does a thing");
  });

  it("handles a plain string", () => {
    expect(formatHoverContents({ contents: "some hover text" })).toBe("some hover text");
  });

  it("returns a fallback when contents are missing", () => {
    expect(formatHoverContents(null)).toContain("No hover information");
    expect(formatHoverContents({})).toContain("No hover information");
    expect(formatHoverContents({ contents: "   " })).toContain("No hover information");
  });
});

describe("TsLanguageServerSession (integration)", () => {
  it("returns symbols for this repo", async () => {
    const { TsLanguageServerSession } = await import("./tsLspSession.js");
    const session = new TsLanguageServerSession(process.cwd());
    const out = await session.workspaceSymbol("runAgentLoop");
    expect(out).toContain("runAgentLoop");
  }, 25_000);
});
