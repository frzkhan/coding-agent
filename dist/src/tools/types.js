export class ToolRegistry {
    tools = new Map();
    register(tool) {
        this.tools.set(tool.name, tool);
    }
    get(name) {
        return this.tools.get(name);
    }
    listNames() {
        return Array.from(this.tools.keys());
    }
    describeTools() {
        return Array.from(this.tools.values())
            .map((tool) => {
            const parts = [tool.name];
            if (tool.parameters)
                parts.push(`args: ${tool.parameters}`);
            if (tool.description)
                parts.push(tool.description);
            return `- ${parts.join(" - ")}`;
        })
            .join("\n");
    }
}
