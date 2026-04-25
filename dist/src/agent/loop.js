import { compactMessagesToBudget, countMessageTokens, estimateTokens } from "./context.js";
import { formatToolObservation } from "./prompts.js";
import { LlmError } from "../errors.js";
function addTokenUsage(total, usage) {
    const inputTokens = usage.inputTokens ?? 0;
    const outputTokens = usage.outputTokens ?? 0;
    const totalTokens = usage.totalTokens ?? inputTokens + outputTokens;
    const source = total.totalTokens === 0 ? usage.source : total.source === usage.source ? total.source : "mixed";
    return {
        inputTokens: total.inputTokens + inputTokens,
        outputTokens: total.outputTokens + outputTokens,
        totalTokens: total.totalTokens + totalTokens,
        source
    };
}
function responseUsage(response, promptTokens) {
    if (response.usage?.totalTokens !== undefined)
        return response.usage;
    const outputTokens = estimateTokens(response.text);
    return {
        inputTokens: response.usage?.inputTokens ?? promptTokens,
        outputTokens: response.usage?.outputTokens ?? outputTokens,
        totalTokens: response.usage?.totalTokens ?? promptTokens + outputTokens,
        source: "estimated"
    };
}
function summarizeText(value, maxLength = 120) {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength)
        return normalized;
    return `${normalized.slice(0, maxLength - 3)}...`;
}
function summarizeToolArguments(args) {
    const preferredKeys = ["path", "pattern", "query", "command", "old_string", "oldString", "include", "line", "character"];
    const parts = preferredKeys
        .filter((key) => args[key] !== undefined)
        .map((key) => `${key}=${JSON.stringify(args[key])}`);
    const selected = parts.length > 0 ? parts : Object.entries(args).slice(0, 3).map(([key, value]) => `${key}=${JSON.stringify(value)}`);
    if (selected.length === 0)
        return "";
    return summarizeText(selected.join(" "), 160);
}
function summarizeToolResult(result) {
    const status = result.ok ? "succeeded" : "failed";
    return `Tool ${status}: ${summarizeText(result.output, 140)}`;
}
// An error paste or traceback with no explicit instruction is treated as an
// implicit fix request, so the reject-final-without-mutation guard still fires.
export function looksLikeErrorPaste(task) {
    if (!task)
        return false;
    if (/\b(Error|TypeError|RangeError|ReferenceError|SyntaxError|URIError|EvalError|Exception)\b:/.test(task)) {
        return true;
    }
    if (/Traceback \(most recent call last\)/.test(task))
        return true;
    if (/\bat .+:\d+(?::\d+)?\b/.test(task))
        return true;
    if (/File ".+?", line \d+/.test(task))
        return true;
    return false;
}
export function taskRequestsWorkspaceChange(task) {
    const text = task ?? "";
    if (/\b(add|change|create|delete|edit|fix|implement|modify|refactor|remove|rename|replace|update|write)\b/i.test(text)) {
        return true;
    }
    return looksLikeErrorPaste(text);
}
function finalClaimsWorkspaceChange(final) {
    return /\b(applied|changed|completed|created|deleted|edited|fixed|implemented|modified|removed|renamed|replaced|updated|wrote)\b/i.test(final);
}
function isMutatingTool(name) {
    return name === "writeFile" || name === "str_replace" || name === "shell";
}
function isTypeScriptFilePath(path) {
    return typeof path === "string" && /\.(tsx?|mts|cts|jsx?|mjs|cjs)$/i.test(path);
}
function invalidModelOutputReminder(error) {
    return [
        `The previous model response could not be parsed as the required agent JSON: ${error.message}`,
        "Return exactly one valid JSON object matching the agent schema.",
        "If you call a tool, include all required arguments for that specific tool in toolCall.arguments.",
        'Example search call: {"thought":"searching","done":false,"final":"","toolCall":{"name":"search","arguments":{"pattern":"label","include":"src/**/*.ts"}}}'
    ].join("\n");
}
// Heuristic: treat raw model text as "still planning" when it clearly
// announces another action rather than giving a self-contained answer.
// These models often emit a thought like `Thinking: ... Let me read X.`
// when the structured output fails, which is not a final answer.
export function looksLikeContinuation(text) {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized)
        return false;
    if (/^(thinking|thought)\s*[:\-]/i.test(normalized))
        return true;
    return /\b(let me|let's|i'?ll|i am going to|i'?m going to|i will|i need to|i should|next,? i|now i'?ll|now i will)\b[^.?!]{0,80}\b(search|look|read|check|verify|confirm|find|inspect|examine|explore|review|investigate|open|list|run|call)\b/i.test(normalized);
}
export async function runAgentLoop(params) {
    let messages = params.messages
        ? [...params.messages]
        : [{ role: "system", content: params.systemPrompt }];
    let tokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        source: "provider"
    };
    let sawSuccessfulMutation = false;
    let sawToolResult = false;
    if (params.task?.trim()) {
        messages.push({ role: "user", content: params.task });
    }
    if (messages.length === 0 || messages[0]?.role !== "system") {
        messages.unshift({ role: "system", content: params.systemPrompt });
    }
    for (let step = 1; step <= params.maxSteps; step += 1) {
        if (params.contextTokenLimit) {
            const context = compactMessagesToBudget(messages, params.contextTokenLimit);
            if (context.compacted) {
                messages = context.messages;
                params.onStep?.(step, `Compacted context ${context.beforeTokens} -> ${context.afterTokens} estimated tokens`);
            }
        }
        const promptTokens = countMessageTokens(messages);
        params.onStep?.(step, `Calling model with ~${promptTokens} context tokens`);
        let response;
        try {
            response = await params.llmClient.generate(messages, {
                onChunk: (chunk) => params.onModelChunk?.(step, chunk)
            });
        }
        catch (error) {
            if (!(error instanceof LlmError)) {
                throw error;
            }
            const rawFallback = error.rawText?.trim();
            const canSalvageRaw = !!rawFallback && sawToolResult && !taskRequestsWorkspaceChange(params.task);
            const rawLooksLikePlan = !!rawFallback && looksLikeContinuation(rawFallback);
            if (canSalvageRaw && !rawLooksLikePlan) {
                params.onStep?.(step, "Using raw model answer after invalid structured output");
                messages.push({
                    role: "assistant",
                    content: rawFallback
                });
                tokenUsage = addTokenUsage(tokenUsage, responseUsage({ text: rawFallback, done: true }, promptTokens));
                return {
                    stopReason: "done",
                    steps: step,
                    finalResponse: rawFallback,
                    messages,
                    tokenUsage
                };
            }
            if (rawLooksLikePlan) {
                params.onStep?.(step, `Model output invalid (raw looked like a plan, not an answer): ${summarizeText(error.message, 160)}`);
            }
            else {
                params.onStep?.(step, `Model output invalid: ${summarizeText(error.message, 160)}`);
            }
            messages.push({
                role: "user",
                content: invalidModelOutputReminder(error)
            });
            continue;
        }
        tokenUsage = addTokenUsage(tokenUsage, responseUsage(response, promptTokens));
        messages.push({
            role: "assistant",
            content: response.done ? response.text : `Thinking: ${response.text}`
        });
        if (response.done) {
            if (taskRequestsWorkspaceChange(params.task) &&
                finalClaimsWorkspaceChange(response.text) &&
                !sawSuccessfulMutation) {
                const warning = "Rejected final answer: it claimed workspace changes were complete, but no writeFile, str_replace, or shell tool succeeded this turn.";
                params.onStep?.(step, warning);
                messages.push({
                    role: "user",
                    content: `${warning} If code changes are needed, call the appropriate mutating tool with all required arguments. If no change is needed, explain that explicitly.`
                });
                continue;
            }
            params.onStep?.(step, "Model produced final answer");
            return {
                stopReason: "done",
                steps: step,
                finalResponse: response.text,
                messages,
                tokenUsage
            };
        }
        params.onStep?.(step, `Thought: ${summarizeText(response.text)}`);
        if (!response.toolCall) {
            return {
                stopReason: "blocked",
                steps: step,
                finalResponse: "Model did not return a tool call or final answer.",
                messages,
                tokenUsage
            };
        }
        const toolArgsSummary = summarizeToolArguments(response.toolCall.arguments);
        const requestedTool = toolArgsSummary
            ? `${response.toolCall.name} (${toolArgsSummary})`
            : response.toolCall.name;
        const tool = params.toolRegistry.get(response.toolCall.name);
        if (!tool) {
            const result = {
                ok: false,
                output: `Unknown tool requested: ${response.toolCall.name}. Available tools: ${params.toolRegistry
                    .listNames()
                    .join(", ")}`
            };
            messages.push({
                role: "tool",
                content: formatToolObservation(response.toolCall.name, result)
            });
            params.onStep?.(step, `Tool unavailable: ${requestedTool}`);
            continue;
        }
        params.onStep?.(step, `Calling tool: ${requestedTool}`);
        let result;
        try {
            result = await tool.run(response.toolCall.arguments);
        }
        catch (error) {
            result = {
                ok: false,
                output: error instanceof Error ? error.message : String(error)
            };
        }
        messages.push({
            role: "tool",
            content: formatToolObservation(tool.name, result)
        });
        sawToolResult = true;
        if (result.ok && isMutatingTool(tool.name)) {
            sawSuccessfulMutation = true;
        }
        params.onStep?.(step, summarizeToolResult(result));
        if (result.ok &&
            (tool.name === "writeFile" || tool.name === "str_replace") &&
            isTypeScriptFilePath(response.toolCall.arguments.path)) {
            const diagnosticsTool = params.toolRegistry.get("tsDiagnostics");
            if (diagnosticsTool) {
                const mutatedPath = response.toolCall.arguments.path;
                let diagnosticsResult;
                try {
                    diagnosticsResult = await diagnosticsTool.run({ path: mutatedPath });
                }
                catch (error) {
                    diagnosticsResult = {
                        ok: false,
                        output: error instanceof Error ? error.message : String(error)
                    };
                }
                messages.push({
                    role: "tool",
                    content: `Auto-verification after ${tool.name} on ${mutatedPath}:\n${formatToolObservation("tsDiagnostics", diagnosticsResult)}`
                });
                params.onStep?.(step, `Auto-verified ${mutatedPath}: ${summarizeText(diagnosticsResult.output, 120)}`);
            }
        }
    }
    return {
        stopReason: "max_steps_reached",
        steps: params.maxSteps,
        finalResponse: "Stopped because max steps limit was reached.",
        messages,
        tokenUsage
    };
}
