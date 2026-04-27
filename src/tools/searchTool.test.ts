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

  it("accepts query as a compatibility alias for pattern", async () => {
    await withTempWorkspace(async (workspace) => {
      await writeFile(path.join(workspace, "sample.ts"), "target()\n", "utf8");

      const result = await new SearchTool(workspace).run({ query: "target" });

      expect(result.ok).toBe(true);
      expect(result.output).toContain("sample.ts:1: target()");
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

  it("matches lines where allWords tokens all appear (case-insensitive)", async () => {
    await withTempWorkspace(async (workspace) => {
      await writeFile(
        path.join(workspace, "cli.ts"),
        "function formatPersistedStep(step: number, maxSteps: number): string {\n  const prefix = `Step ${step}/${maxSteps}: `;\n}\n",
        "utf8"
      );

      const result = await new SearchTool(workspace).run({
        allWords: "step maxsteps",
        include: "*.ts"
      });

      expect(result.ok).toBe(true);
      expect(result.output).toContain("cli.ts:2:");
      expect(result.output).toContain("Step ${step}/${maxSteps}");
    });
  });

  it("allows allWords without pattern", async () => {
    await withTempWorkspace(async (workspace) => {
      await writeFile(path.join(workspace, "a.ts"), "foo\n", "utf8");

      const result = await new SearchTool(workspace).run({ allWords: "missingtoken" });

      expect(result.ok).toBe(true);
      expect(result.output).toBe("No matches.");
    });
  });

  it("literal:true treats pattern as a substring, not regex", async () => {
    await withTempWorkspace(async (workspace) => {
      await writeFile(path.join(workspace, "x.ts"), "const x = a[0] + 1;\n", "utf8");

      const bad = await new SearchTool(workspace).run({ pattern: "a[0]" });
      expect(bad.ok).toBe(true);
      expect(bad.output).toBe("No matches.");

      const good = await new SearchTool(workspace).run({ pattern: "a[0]", literal: true });
      expect(good.ok).toBe(true);
      expect(good.output).toContain("x.ts:1:");
    });
  });

  it("combines allWords with pattern (both must match)", async () => {
    await withTempWorkspace(async (workspace) => {
      await writeFile(path.join(workspace, "m.ts"), "alpha one\nbeta one\n", "utf8");

      const result = await new SearchTool(workspace).run({
        allWords: "alpha beta",
        pattern: "one"
      });

      expect(result.ok).toBe(true);
      expect(result.output).toBe("No matches.");
    });

    await withTempWorkspace(async (workspace) => {
      await writeFile(path.join(workspace, "m.ts"), "alpha beta one\n", "utf8");

      const result = await new SearchTool(workspace).run({
        allWords: "alpha beta",
        pattern: "one"
      });

      expect(result.ok).toBe(true);
      expect(result.output).toContain("m.ts:1:");
    });
  });
});
