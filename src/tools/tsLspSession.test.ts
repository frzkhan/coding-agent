import { describe, expect, it } from "vitest";
import { flattenLocations, formatLocation, pathToDocumentUri } from "./tsLspSession.js";

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

describe("TsLanguageServerSession (integration)", () => {
  it("returns symbols for this repo", async () => {
    const { TsLanguageServerSession } = await import("./tsLspSession.js");
    const session = new TsLanguageServerSession(process.cwd());
    const out = await session.workspaceSymbol("runAgentLoop");
    expect(out).toContain("runAgentLoop");
  }, 25_000);
});
