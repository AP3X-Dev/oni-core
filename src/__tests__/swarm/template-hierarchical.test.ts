import { describe, it, expect, vi } from "vitest";
import {
  SwarmGraph,
  type BaseSwarmState, type SwarmAgentDef,
} from "../../swarm/index.js";
import { StateGraph, START, END, lastValue, appendList, mergeObject } from "../../index.js";
import type { ONIModel } from "../../models/types.js";

function makeChannels() {
  return {
    task: lastValue(() => ""),
    context: mergeObject(() => ({})),
    agentResults: mergeObject(() => ({})),
    messages: appendList(() => [] as Array<{ role: string; content: string }>),
    swarmMessages: appendList(() => []),
    supervisorRound: lastValue(() => 0),
    currentAgent: lastValue(() => null as string | null),
    done: lastValue(() => false),
    handoffHistory: appendList(() => []),
  };
}

function buildAgent(id: string, response: string, markDone = false): SwarmAgentDef<BaseSwarmState> {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async () => ({
    messages: [{ role: "assistant", content: response }],
    ...(markDone ? { done: true } : {}),
  }));
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return {
    id,
    role: id,
    capabilities: [{ name: id, description: `Does ${id}` }],
    skeleton: g.compile() as any,
  };
}

function mockModel(agentSequence: string[]): ONIModel {
  let callIdx = 0;
  return {
    provider: "test",
    modelId: "test",
    capabilities: { tools: true, vision: false, streaming: true, embeddings: false },
    chat: vi.fn().mockImplementation(async () => ({
      content: agentSequence[callIdx++] ?? agentSequence[agentSequence.length - 1],
      usage: { inputTokens: 10, outputTokens: 5 },
      stopReason: "end" as const,
    })),
    async *stream() {},
  };
}

describe("SwarmGraph.hierarchical()", () => {
  it("creates a supervisor → workers swarm from config", async () => {
    const model = mockModel(["researcher", "writer"]);

    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: {
        model,
        strategy: "llm",
        maxRounds: 5,
      },
      agents: [
        buildAgent("researcher", "Research done"),
        buildAgent("writer", "Writing done", true),
      ],
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "Write an article" });

    expect(result.done).toBe(true);
    expect(result.messages.length).toBeGreaterThan(0);
    expect(model.chat).toHaveBeenCalled();
  });

  it("works with rule-based routing", async () => {
    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: {
        strategy: "rule",
        maxRounds: 3,
        rules: [
          { condition: (_, ctx) => ((ctx as any).supervisorRound ?? 0) === 0, agentId: "a" },
          { condition: () => true, agentId: "b" },
        ],
      },
      agents: [
        buildAgent("a", "A done"),
        buildAgent("b", "B done", true),
      ],
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "test" });
    expect(result.done).toBe(true);
  });

  it("applies retry-then-fallback on agent failure", async () => {
    let failCount = 0;
    const failChannels = makeChannels();
    const failGraph = new StateGraph<BaseSwarmState>({ channels: failChannels });
    failGraph.addNode("work", async () => {
      failCount++;
      if (failCount <= 3) throw new Error("fail");
      return { done: true };
    });
    failGraph.addEdge(START, "work");
    failGraph.addEdge("work", END);

    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: {
        strategy: "rule",
        maxRounds: 5,
        rules: [
          { condition: (_, ctx) => !!(ctx as any).lastAgentError, agentId: "backup" },
          { condition: () => true, agentId: "flaky" },
        ],
      },
      agents: [
        {
          id: "flaky",
          role: "Flaky",
          capabilities: [],
          skeleton: failGraph.compile() as any,
          maxRetries: 1,
        },
        buildAgent("backup", "Backup done", true),
      ],
      onError: "fallback",
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "retry test" });
    expect(result.done).toBe(true);
  });
});
