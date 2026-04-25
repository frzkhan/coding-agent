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
    rawText;
    constructor(message, options = {}) {
        super(message);
        this.name = "LlmError";
        this.rawText = options.rawText;
    }
}
