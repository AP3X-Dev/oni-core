import { describe, it, expect, vi } from "vitest";
import { StateGraph, START, END, lastValue, appendList } from "../index.js";
import { defineAgent } from "../agents/define-agent.js";
import { agent } from "../agents/functional-agent.js";
import type { ONIModel } from "../models/types.js";

function mockModel(response: string): ONIModel {
  return {
    provider: "test",
    modelId: "test",
    capabilities: { tools: true, vision: false, streaming: true, embeddings: false },
    chat: vi.fn().mockResolvedValue({
      content: response,
      usage: { inputTokens: 10, outputTokens: 5 },
      stopReason: "end" as const,
    }),
    async *stream() {},
  };
}

describe("addAgent on StateGraph", () => {
  it("addAgent accepts defineAgent result and wires as node", async () => {
    const model = mockModel("Agent response");
    const researcher = defineAgent({
      name: "researcher",
      description: "Researches",
      model,
    });

    type S = { messages: Array<{ role: string; content: string }> };
    const g = new StateGraph<S>({
      channels: { messages: appendList(() => []) },
    });

    g.addAgent(researcher);
    g.addEdge(START, "researcher");
    g.addEdge("researcher", END);

    const app = g.compile();
    const result = await app.invoke({ messages: [{ role: "user", content: "Hello" }] });

    expect(result.messages.length).toBeGreaterThan(1);
    expect(model.chat).toHaveBeenCalled();
  });

  it("addAgent accepts functional agent() result", async () => {
    const a = agent("processor", async (ctx) => {
      return { output: "processed" };
    });

    type S = { output: string };
    const g = new StateGraph<S>({
      channels: { output: lastValue(() => "") },
    });

    g.addAgent(a);
    g.addEdge(START, "processor");
    g.addEdge("processor", END);

    const app = g.compile();
    const result = await app.invoke({});

    expect(result.output).toBe("processed");
  });
});
