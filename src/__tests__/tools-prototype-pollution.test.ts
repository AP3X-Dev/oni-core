import { describe, it, expect, vi } from "vitest";
import { executeTools, buildToolMap } from "../harness/loop/tools.js";
import type { ToolExecutionContext } from "../harness/loop/tools.js";
import type { ONIModelToolCall } from "../models/types.js";
import type { ToolDefinition } from "../tools/types.js";
import { HooksEngine } from "../harness/hooks-engine.js";

describe("executeTools prototype pollution guard", () => {
  it("BUG-0024: should strip __proto__, constructor, and prototype keys from hook modifiedInput", async () => {
    const executeFn = vi.fn(() => "ok");
    const tool: ToolDefinition = {
      name: "TestTool",
      description: "test",
      schema: { type: "object", properties: { input: { type: "string" } } },
      execute: executeFn,
    };

    const hooksEngine = new HooksEngine();
    // Mock fire() to return a result with modifiedInput containing dangerous keys
    vi.spyOn(hooksEngine, "fire").mockResolvedValue({
      decision: "allow",
      modifiedInput: {
        input: "safe-value",
        "__proto__": { polluted: true },
        "constructor": { polluted: true },
        "prototype": { polluted: true },
      },
    });

    const toolCalls: ONIModelToolCall[] = [
      { id: "tc-1", name: "TestTool", args: { input: "original" } },
    ];

    const ctx: ToolExecutionContext = {
      sessionId: "s1",
      threadId: "t1",
      turn: 0,
      config: {
        model: { chat: vi.fn(), stream: vi.fn(), provider: "mock", modelId: "mock", capabilities: { tools: true, vision: false, streaming: false, embeddings: false } },
        tools: [tool],
        agentName: "test",
        systemPrompt: "test",
        maxTurns: 1,
        hooksEngine,
      },
      toolMap: buildToolMap([tool]),
      hasMemoryLoader: false,
    };

    // Verify Object.prototype is clean before the call
    expect((Object.prototype as Record<string, unknown>)["polluted"]).toBeUndefined();

    await executeTools(toolCalls, ctx);

    // Object.prototype must not be polluted
    expect((Object.prototype as Record<string, unknown>)["polluted"]).toBeUndefined();

    // The safe key should have been applied
    expect(toolCalls[0]!.args.input).toBe("safe-value");

    // The dangerous keys should NOT be on the args object
    expect(Object.keys(toolCalls[0]!.args)).not.toContain("__proto__");
    expect(Object.keys(toolCalls[0]!.args)).not.toContain("constructor");
    expect(Object.keys(toolCalls[0]!.args)).not.toContain("prototype");
  });
});
