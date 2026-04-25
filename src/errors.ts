export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export class ToolExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolExecutionError";
  }
}

export class LlmError extends Error {
  readonly rawText?: string;

  constructor(message: string, options: { rawText?: string } = {}) {
    super(message);
    this.name = "LlmError";
    this.rawText = options.rawText;
  }
}
