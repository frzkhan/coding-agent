import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SearchTool } from "./searchTool.js";

async function withTempWorkspace<T>(fn: (workspace: string) => Promise<T>): Promise<T> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "coding-agent-search-"));
  try {
    return await fn(workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

describe("SearchTool", () => {
  it("returns path, line number, and context for regex matches", async () => {
    await withTempWorkspace(async (workspace) => {
      await writeFile(path.join(workspace, "sample.ts"), "one\ntarget()\nthree\n", "utf8");

      const result = await new SearchTool(workspace).run({
        pattern: "target\\(",
        context: 1
      });

      expect(result.ok).toBe(true);
      expect(result.output).toContain("sample.ts:1: one");
      expect(result.output).toContain("sample.ts:2: target()");
      expect(result.output).toContain("sample.ts:3: three");
    });
  });

  it("does not search ignored directories or .env", async () => {
    await withTempWorkspace(async (workspace) => {
      await mkdir(path.join(workspace, "node_modules"));
      await writeFile(path.join(workspace, "node_modules", "secret.ts"), "target()\n", "utf8");
      await writeFile(path.join(workspace, ".env"), "target=true\n", "utf8");

      const result = await new SearchTool(workspace).run({ pattern: "target" });

      expect(result.ok).toBe(true);
      expect(result.output).toBe("No matches.");
    });
  });
});
