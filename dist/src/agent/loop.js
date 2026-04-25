import { compactMessagesToBudget, countMessageTokens, estimateTokens } from "./context.js";
import { formatToolObservation } from "./prompts.js";
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
        const response = await params.llmClient.generate(messages, {
            onChunk: (chunk) => params.onModelChunk?.(step, chunk)
        });
        tokenUsage = addTokenUsage(tokenUsage, responseUsage(response, promptTokens));
        messages.push({
            role: "assistant",
            content: response.done ? response.text : `Thinking: ${response.text}`
        });
        if (response.done) {
            return {
                stopReason: "done",
                steps: step,
                finalResponse: response.text,
                messages,
                tokenUsage
            };
        }
        if (!response.toolCall) {
            return {
                stopReason: "blocked",
                steps: step,
                finalResponse: "Model did not return a tool call or final answer.",
                messages,
                tokenUsage
            };
        }
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
            continue;
        }
        params.onStep?.(step, `Running tool ${tool.name}`);
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
    }
    return {
        stopReason: "max_steps_reached",
        steps: params.maxSteps,
        finalResponse: "Stopped because max steps limit was reached.",
        messages,
        tokenUsage
    };
}
