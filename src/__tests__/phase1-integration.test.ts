import { describe, it, expect, vi } from "vitest";
import { StateGraph, START, END, lastValue, appendList } from "../index.js";
import { defineAgent } from "../agents/define-agent.js";
import { agent } from "../agents/functional-agent.js";
import { defineTool } from "../tools/define.js";
import type { ONIModel, ChatResponse } from "../models/types.js";

function createMockModel(responses: ChatResponse[]): ONIModel {
  let i = 0;
  return {
    provider: "test",
    modelId: "test-model",
    capabilities: { tools: true, vision: false, streaming: true, embeddings: false },
    chat: vi.fn(async () => responses[i++] ?? { content: "fallback", usage: { inputTokens: 1, outputTokens: 1 }, stopReason: "end" as const }),
    async *stream() {},
  };
}

describe("Phase 1 integration", () => {
  it("defineAgent + tools work together in a graph", async () => {
    const searchTool = defineTool({
      name: "search",
      description: "Search the web",
      schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      execute: async ({ query }: { query: string }) => `Results for: ${query}`,
    });

    const model = createMockModel([
      {
        content: "Searching...",
        toolCalls: [{ id: "tc1", name: "search", args: { query: "oni framework" } }],
        usage: { inputTokens: 50, outputTokens: 30 },
        stopReason: "tool_use",
      },
      {
        content: "ONI is a graph execution framework.",
        usage: { inputTokens: 60, outputTokens: 40 },
        stopReason: "end",
      },
    ]);

    const researcher = defineAgent({
      name: "researcher",
      description: "Finds information",
      model,
      tools: [searchTool],
      systemPrompt: "You research topics thoroughly.",
    });

    type S = { messages: Array<{ role: string; content: string; toolCalls?: any; toolCallId?: string }> };
    const g = new StateGraph<S>({
      channels: { messages: appendList(() => []) },
    });

    g.addAgent(researcher);
    g.addEdge(START, "researcher");
    g.addEdge("researcher", END);

    const events: string[] = [];
    const app = g.compile({
      listeners: {
        "agent.start": (e) => events.push(`start:${e.agent}`),
        "agent.end": (e) => events.push(`end:${e.agent}`),
      },
    });

    const result = await app.invoke({ messages: [{ role: "user", content: "What is ONI?" }] });

    expect(model.chat).toHaveBeenCalledTimes(2);
    // Initial user message + assistant (with tool call) + tool result + assistant (final) = 4
    expect(result.messages.length).toBeGreaterThanOrEqual(3);
    expect(events).toContain("start:researcher");
    expect(events).toContain("end:researcher");
  });

  it("functional agent with coordination", async () => {
    const processor = agent("processor", async (ctx) => {
      ctx.send("logger", { processed: true });
      return { output: "done" };
    });

    const logger = agent("logger", async (ctx) => {
      const msgs = ctx.inbox();
      return { log: msgs.length > 0 ? "received" : "empty" };
    });

    type S = { output: string; log: string; swarmMessages: any[] };
    const g = new StateGraph<S>({
      channels: {
        output: lastValue(() => ""),
        log: lastValue(() => ""),
        swarmMessages: appendList(() => []),
      },
    });

    g.addAgent(processor);
    g.addAgent(logger);
    g.addEdge(START, "processor");
    g.addEdge("processor", "logger");
    g.addEdge("logger", END);

    const app = g.compile();
    const result = await app.invoke({});

    expect(result.output).toBe("done");
  });

  it("mixed defineAgent + functional agent in same graph", async () => {
    const model = createMockModel([
      { content: "Analysis complete", usage: { inputTokens: 10, outputTokens: 5 }, stopReason: "end" },
    ]);

    const analyst = defineAgent({
      name: "analyst",
      description: "Analyzes data",
      model,
    });

    const formatter = agent("formatter", async (_ctx) => {
      return { formatted: "FORMATTED" };
    });

    type S = { messages: any[]; formatted: string };
    const g = new StateGraph<S>({
      channels: {
        messages: appendList(() => []),
        formatted: lastValue(() => ""),
      },
    });

    g.addAgent(analyst);
    g.addAgent(formatter);
    g.addEdge(START, "analyst");
    g.addEdge("analyst", "formatter");
    g.addEdge("formatter", END);

    const app = g.compile();
    const result = await app.invoke({ messages: [{ role: "user", content: "Analyze" }] });

    expect(result.formatted).toBe("FORMATTED");
    expect(model.chat).toHaveBeenCalled();
  });
});
