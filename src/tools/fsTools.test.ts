import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ReadFileTool, StrReplaceTool } from "./fsTools.js";

async function withTempWorkspace<T>(fn: (workspace: string) => Promise<T>): Promise<T> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "coding-agent-fs-"));
  try {
    return await fn(workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

describe("StrReplaceTool", () => {
  it("replaces a unique string in a file", async () => {
    await withTempWorkspace(async (workspace) => {
      const filePath = path.join(workspace, "sample.txt");
      await writeFile(filePath, "hello old world\n", "utf8");

      const result = await new StrReplaceTool(workspace).run({
        path: "sample.txt",
        old_string: "old",
        new_string: "new"
      });

      await expect(readFile(filePath, "utf8")).resolves.toBe("hello new world\n");
      expect(result.ok).toBe(true);
    });
  });

  it("refuses ambiguous replacements", async () => {
    await withTempWorkspace(async (workspace) => {
      await writeFile(path.join(workspace, "sample.txt"), "same same\n", "utf8");

      const result = await new StrReplaceTool(workspace).run({
        path: "sample.txt",
        old_string: "same",
        new_string: "different"
      });

      expect(result.ok).toBe(false);
      expect(result.output).toContain("matched 2 times");
    });
  });
});

describe("ReadFileTool", () => {
  it("refuses ignored paths", async () => {
    await withTempWorkspace(async (workspace) => {
      await writeFile(path.join(workspace, ".env"), "SECRET=value\n", "utf8");

      const result = await new ReadFileTool(workspace).run({ path: ".env" });

      expect(result.ok).toBe(false);
      expect(result.output).toContain("ignored");
    });
  });
});
