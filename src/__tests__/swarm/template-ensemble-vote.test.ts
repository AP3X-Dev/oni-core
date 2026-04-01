import { describe, it, expect, vi } from "vitest";
import { SwarmGraph, type BaseSwarmState } from "../../swarm/index.js";
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

function makeAgent(id: string, outputCtx: Record<string, unknown>) {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async (state) => ({
    context: { ...(state.context ?? {}), ...outputCtx },
  }));
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return {
    id,
    role: id,
    capabilities: [],
    skeleton: g.compile() as any,
  };
}

describe("SwarmGraph.ensembleVote()", () => {
  it("vote mode: judge picks winner", async () => {
    const agentA = makeAgent("agent-a", { answer: "Short answer" });
    const agentB = makeAgent("agent-b", { answer: "More detailed answer with explanation" });

    const judgeModel: ONIModel = {
      provider: "test",
      modelId: "judge",
      capabilities: { tools: false, vision: false, streaming: false, embeddings: false },
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({ winner: "agent-b", reasoning: "More detailed" }),
        usage: { inputTokens: 10, outputTokens: 5 },
        stopReason: "end" as const,
      }),
      async *stream() {},
    };

    const swarm = SwarmGraph.ensembleVote<BaseSwarmState>({
      agents: [agentA, agentB],
      mode: "vote",
      judge: {
        model: judgeModel,
        systemPrompt: "You are evaluating multiple agent responses. Pick the best one.",
      },
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "answer the question" });

    expect(result.done).toBe(true);
    expect(result.context.winner).toBe("agent-b");
    expect(result.context.reasoning).toBe("More detailed");
    expect(judgeModel.chat).toHaveBeenCalledTimes(1);
    expect(Object.keys(result.agentResults)).toHaveLength(2);
  });

  it("synthesize mode: synthesizer merges outputs", async () => {
    const agentA = makeAgent("agent-a", { partA: "contribution from A" });
    const agentB = makeAgent("agent-b", { partB: "contribution from B" });
    const agentC = makeAgent("agent-c", { partC: "contribution from C" });

    // Synthesizer reads agentResults and returns a merged context
    const synthGraph = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
    synthGraph.addNode("work", async (state) => {
      const keys = Object.keys(state.agentResults ?? {}).sort();
      return {
        context: {
          ...(state.context ?? {}),
          synthesizedResult: `merged: ${keys.join(",")}`,
        },
      };
    });
    synthGraph.addEdge(START, "work");
    synthGraph.addEdge("work", END);
    const synthesizer = {
      id: "synthesizer",
      role: "synthesizer",
      capabilities: [],
      skeleton: synthGraph.compile() as any,
    };

    const swarm = SwarmGraph.ensembleVote<BaseSwarmState>({
      agents: [agentA, agentB, agentC],
      mode: "synthesize",
      synthesizer,
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "merge all outputs" });

    expect(result.done).toBe(true);
    expect(result.context.synthesizedResult).toContain("agent-a");
    expect(result.context.synthesizedResult).toContain("agent-b");
    expect(result.context.synthesizedResult).toContain("agent-c");
  });

  it("custom mode: user function aggregates results", async () => {
    const agentA = makeAgent("agent-a", { valA: 1 });
    const agentB = makeAgent("agent-b", { valB: 2 });

    const swarm = SwarmGraph.ensembleVote<BaseSwarmState>({
      agents: [agentA, agentB],
      mode: (agentResults) => ({
        context: {
          customResult: Object.keys(agentResults).sort().join(","),
        },
        done: true,
      }),
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "custom aggregation" });

    expect(result.done).toBe(true);
    expect(result.context.customResult).toContain("agent-a");
    expect(result.context.customResult).toContain("agent-b");
  });
});
