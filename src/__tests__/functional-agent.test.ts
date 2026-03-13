import { describe, it, expect, vi } from "vitest";
import { agent } from "../agents/functional-agent.js";
import type { ONIModel } from "../models/types.js";

// ---- Helpers ----

function mockModel(overrides: Partial<ONIModel> = {}): ONIModel {
  return {
    provider: "test",
    modelId: "test-model",
    capabilities: { tools: true, vision: false, streaming: true, embeddings: false },
    chat: vi.fn(async () => ({
      content: "Mock response",
      usage: { inputTokens: 10, outputTokens: 5 },
      stopReason: "end" as const,
    })),
    async *stream() {
      yield { type: "text" as const, text: "chunk" };
    },
    ...overrides,
  };
}

describe("agent() — functional agent factory", () => {
  it("creates an AgentNode with _isAgent marker", () => {
    const a = agent("myAgent", async (_ctx) => ({}));

    expect(a.name).toBe("myAgent");
    expect(a._isAgent).toBe(true);
    expect(typeof a._nodeFn).toBe("function");
    expect(a.tools).toEqual([]);
    expect(a.maxSteps).toBe(10);
  });

  it("handler receives AgentContext and can return state update", async () => {
    const model = mockModel();

    const a = agent<{ count: number }>("counter", { model }, async (ctx) => {
      expect(ctx.agentName).toBe("counter");
      expect(ctx.state.count).toBe(5);
      expect(ctx.config).toBeDefined();

      const resp = await ctx.chat([{ role: "user", content: "hi" }]);
      expect(resp.content).toBe("Mock response");

      return { count: ctx.state.count + 1 };
    });

    const result = await a._nodeFn({ count: 5 }, { threadId: "t1" });

    expect(result.count).toBe(6);
    expect(model.chat).toHaveBeenCalledTimes(1);
  });

  it("accepts options object with model", () => {
    const model = mockModel();

    const a = agent("withOpts", { model, maxSteps: 5, maxTokens: 2000 }, async (_ctx) => ({}));

    expect(a.name).toBe("withOpts");
    expect(a.model).toBe(model);
    expect(a.maxSteps).toBe(5);
    expect(a.maxTokens).toBe(2000);
    expect(a._isAgent).toBe(true);
  });

  it("send() queues messages into swarmMessages", async () => {
    const a = agent("sender", async (ctx) => {
      ctx.send("agentB", { task: "process" });
      ctx.send("agentC", { task: "validate" });
      return {};
    });

    const result = await a._nodeFn({} as Record<string, unknown>, {});

    // swarmMessages should contain the two queued messages
    const msgs = (result as Record<string, unknown>).swarmMessages as Array<{
      id: string;
      from: string;
      content: unknown;
      timestamp: number;
    }>;
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.from).toBe("sender");
    expect(msgs[0]!.content).toEqual({ task: "process" });
    expect(msgs[1]!.from).toBe("sender");
    expect(msgs[1]!.content).toEqual({ task: "validate" });
    // Each message has an id and timestamp
    expect(typeof msgs[0]!.id).toBe("string");
    expect(typeof msgs[0]!.timestamp).toBe("number");
  });

  it("throws helpful error when calling chat without model", async () => {
    const a = agent("noModel", async (ctx) => {
      await ctx.chat([{ role: "user", content: "test" }]);
      return {};
    });

    await expect(a._nodeFn({} as Record<string, unknown>, {})).rejects.toThrow(
      /no model configured/i,
    );
  });

  it("throws when options provided but handler is missing", () => {
    expect(() => {
      // @ts-expect-error intentionally passing undefined handler
      agent("broken", { model: mockModel() }, undefined);
    }).toThrow(/handler function is required/);
  });

  it("inbox() reads swarmMessages from state", async () => {
    const a = agent("reader", async (ctx) => {
      const msgs = ctx.inbox();
      return { received: msgs.length };
    });

    const state = {
      swarmMessages: [
        { id: "m1", from: "other", content: "hello", timestamp: 1000 },
      ],
    } as Record<string, unknown>;

    const result = await a._nodeFn(state, {});
    expect((result as Record<string, unknown>).received).toBe(1);
  });
});
