import { describe, it, expect, vi } from "vitest";
import { buildAgentContext } from "../agents/context.js";
import type { ONIModel } from "../models/types.js";
import type { ToolDefinition } from "../tools/types.js";

function mockModel(): ONIModel {
  return {
    provider: "test",
    modelId: "test-model",
    capabilities: { tools: true, vision: false, streaming: true, embeddings: false },
    chat: vi.fn(async () => ({
      content: "",
      toolCalls: undefined,
      usage: { inputTokens: 0, outputTokens: 0 },
      stopReason: "end" as const,
    })),
    async *stream() {
      yield { type: "text" as const, text: "" };
    },
  };
}

describe("BUG-0059: executeTools respects parallelSafe flag", () => {
  it("BUG-0059: should execute tools sequentially when any has parallelSafe: false", async () => {
    const order: string[] = [];

    const slowTool: ToolDefinition = {
      name: "slow_write",
      description: "A write tool that is not parallel-safe",
      schema: { type: "object", properties: {} },
      parallelSafe: false,
      execute: async () => {
        order.push("slow-start");
        await new Promise((r) => setTimeout(r, 30));
        order.push("slow-end");
        return "wrote";
      },
    };

    const fastTool: ToolDefinition = {
      name: "fast_read",
      description: "A read tool",
      schema: { type: "object", properties: {} },
      parallelSafe: true,
      execute: async () => {
        order.push("fast-start");
        order.push("fast-end");
        return "read";
      },
    };

    const ctx = buildAgentContext({
      model: mockModel(),
      tools: [slowTool, fastTool],
      agentName: "testAgent",
      config: {},
      store: null,
      state: {},
      streamWriter: null,
      remainingSteps: 10,
      onSend: vi.fn(),
      getInbox: vi.fn(() => []),
      onRequest: vi.fn(async () => undefined),
      onReply: vi.fn(),
      onPublish: vi.fn(),
    });

    const results = await ctx.executeTools([
      { id: "call-1", name: "slow_write", args: {} },
      { id: "call-2", name: "fast_read", args: {} },
    ]);

    expect(results).toHaveLength(2);

    // If sequential: slow completes before fast starts.
    // If parallel (Promise.all): fast would start before slow ends.
    // Before the fix, Promise.all was always used, so order would be:
    //   ["slow-start", "fast-start", "fast-end", "slow-end"]
    expect(order).toEqual(["slow-start", "slow-end", "fast-start", "fast-end"]);
  });
});
