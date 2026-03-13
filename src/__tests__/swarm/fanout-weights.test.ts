import { describe, it, expect } from "vitest";
import {
  SwarmGraph, type BaseSwarmState,
} from "../../swarm/index.js";
import { StateGraph, START, END, lastValue, appendList, mergeObject } from "../../index.js";

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

function buildAgent(id: string, score: number) {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async () => ({
    messages: [{ role: "assistant", content: `${id} scored ${score}` }],
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

describe("Fan-out weighted routing", () => {
  it("passes weights to reducer as second argument", async () => {
    let receivedWeights: Record<string, number> | undefined;

    const swarm = SwarmGraph.fanOut<BaseSwarmState>({
      agents: [
        buildAgent("expert", 9),
        buildAgent("novice", 3),
      ],
      weights: { expert: 0.8, novice: 0.2 },
      reducer: (results, weights) => {
        receivedWeights = weights;
        return {
          done: true,
          messages: [{ role: "assistant", content: "weighted result" }],
        };
      },
    });

    const app = swarm.compile();
    await app.invoke({ task: "weighted fanout" });

    expect(receivedWeights).toBeDefined();
    expect(receivedWeights!.expert).toBe(0.8);
    expect(receivedWeights!.novice).toBe(0.2);
  });

  it("reducer can compute weighted aggregation using weights", async () => {
    const swarm = SwarmGraph.fanOut<BaseSwarmState>({
      agents: [
        buildAgent("a", 10),
        buildAgent("b", 5),
      ],
      weights: { a: 0.7, b: 0.3 },
      reducer: (results, weights) => {
        // Weighted sum: use weights to prioritize results
        const totalWeight = Object.values(weights ?? {}).reduce((s, w) => s + w, 0);
        return {
          done: true,
          context: { totalWeight },
          messages: [{ role: "assistant", content: `Total weight: ${totalWeight}` }],
        };
      },
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "aggregate" });

    expect(result.done).toBe(true);
    expect((result.context as Record<string, unknown>).totalWeight).toBeCloseTo(1.0);
  });

  it("works without weights (backwards-compatible)", async () => {
    let reducerCalled = false;

    const swarm = SwarmGraph.fanOut<BaseSwarmState>({
      agents: [buildAgent("solo", 1)],
      // No weights provided — existing behavior
      reducer: (results, weights) => {
        reducerCalled = true;
        // weights should be undefined when not configured
        expect(weights).toBeUndefined();
        return { done: true };
      },
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "no weights" });

    expect(result.done).toBe(true);
    expect(reducerCalled).toBe(true);
  });
});
