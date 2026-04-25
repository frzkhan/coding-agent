export type ToolResult = {
  ok: boolean;
  output: string;
};

export interface Tool {
  readonly name: string;
  readonly description?: string;
  readonly parameters?: string;
  run(args: Record<string, unknown>): Promise<ToolResult>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  listNames(): string[] {
    return Array.from(this.tools.keys());
  }

  describeTools(): string {
    return Array.from(this.tools.values())
      .map((tool) => {
        const parts = [tool.name];
        if (tool.parameters) parts.push(`args: ${tool.parameters}`);
        if (tool.description) parts.push(tool.description);
        return `- ${parts.join(" - ")}`;
      })
      .join("\n");
  }
}
