import { describe, expect, it } from "vitest";
import { formatChatHeader, parseSessionCommand, resolveCliModes } from "./cli.js";
describe("parseSessionCommand", () => {
    it("parses exit aliases", () => {
        expect(parseSessionCommand("/exit")).toEqual({ type: "exit" });
        expect(parseSessionCommand("/quit")).toEqual({ type: "exit" });
    });
    it("parses max command", () => {
        expect(parseSessionCommand("/max 15")).toEqual({ type: "max", value: 15 });
    });
    it("parses dryrun command", () => {
        expect(parseSessionCommand("/dryrun on")).toEqual({ type: "dryrun", value: true });
        expect(parseSessionCommand("/dryrun off")).toEqual({ type: "dryrun", value: false });
    });
    it("returns null for non-command input", () => {
        expect(parseSessionCommand("make a change")).toBeNull();
    });
    it("returns null for unknown command input", () => {
        expect(parseSessionCommand("/doesnotexist")).toBeNull();
    });
});
describe("resolveCliModes", () => {
    it("uses chat by default when no task in TTY", () => {
        expect(resolveCliModes({
            rawTask: "",
            interactiveOption: false,
            chatOption: false,
            canUseTty: true
        })).toEqual({ shouldPromptInteractively: true, shouldUseChat: true });
    });
    it("uses one-shot mode when task is provided and no flags", () => {
        expect(resolveCliModes({
            rawTask: "fix bug",
            interactiveOption: false,
            chatOption: false,
            canUseTty: true
        })).toEqual({ shouldPromptInteractively: false, shouldUseChat: false });
    });
    it("respects explicit chat flag", () => {
        expect(resolveCliModes({
            rawTask: "fix bug",
            interactiveOption: false,
            chatOption: true,
            canUseTty: true
        })).toEqual({ shouldPromptInteractively: false, shouldUseChat: true });
    });
});
describe("formatChatHeader", () => {
    it("includes session state in the Codex-style chat header", () => {
        const header = formatChatHeader({
            model: "test-model",
            dryRun: true,
            maxSteps: 7,
            contextTokenLimit: 12000
        });
        expect(header).toContain("coding-agent");
        expect(header).toContain("model: test-model");
        expect(header).toContain("dry-run: on");
        expect(header).toContain("max steps: 7");
        expect(header).toContain("context: 12000 tokens");
    });
});
