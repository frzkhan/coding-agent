export class ConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = "ConfigError";
    }
}
export class ToolExecutionError extends Error {
    constructor(message) {
        super(message);
        this.name = "ToolExecutionError";
    }
}
export class LlmError extends Error {
    constructor(message) {
        super(message);
        this.name = "LlmError";
    }
}
