import { describe, it, expect } from "vitest";
import { SwarmGraph, type BaseSwarmState } from "../../swarm/index.js";
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

const makeSlow = (id: string, delayMs: number) => {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async () => {
    await new Promise((r) => setTimeout(r, delayMs));
    return { context: { result: id } };
  });
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return { id, role: id, capabilities: [], skeleton: g.compile() as any };
};

describe("SwarmGraph.speculativeExecution()", () => {
  it("first valid strategy wins", async () => {
    const slow = makeSlow("slow", 200);
    const fast = makeSlow("fast", 10);

    const swarm = SwarmGraph.speculativeExecution<BaseSwarmState>({
      strategies: [slow, fast],
      validator: (result) => {
        const ctx = (result as any)?.context;
        return ctx?.result != null;
      },
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "race" });

    expect(result.done).toBe(true);
    expect(result.context.winnerId).toBe("fast");
  });

  it("calls onCancel for losing strategies", async () => {
    const fast = makeSlow("fast", 10);
    const slow = makeSlow("slow", 500);
    const cancelled: string[] = [];

    const swarm = SwarmGraph.speculativeExecution<BaseSwarmState>({
      strategies: [fast, slow],
      validator: (result) => {
        const ctx = (result as any)?.context;
        return ctx?.result != null;
      },
      onCancel: async (agentId) => {
        cancelled.push(agentId);
      },
    });

    const app = swarm.compile();
    await app.invoke({ task: "cancel test" });

    expect(cancelled).toContain("slow");
  });

  it("all strategies fail sets winnerId null", async () => {
    const agentA = makeSlow("agent-a", 10);
    const agentB = makeSlow("agent-b", 20);

    const swarm = SwarmGraph.speculativeExecution<BaseSwarmState>({
      strategies: [agentA, agentB],
      validator: () => false,
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "all fail" });

    expect(result.done).toBe(true);
    expect(result.context.winnerId).toBe(null);
  });
});
