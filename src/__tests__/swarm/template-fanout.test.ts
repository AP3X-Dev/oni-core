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

function buildAgent(id: string, response: string) {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async (state) => ({
    messages: [{ role: "assistant", content: `${response}: ${state.task}` }],
  }));
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return {
    id,
    role: id,
    capabilities: [{ name: id, description: id }],
    skeleton: g.compile() as any,
  };
}

describe("SwarmGraph.fanOut()", () => {
  it("runs all agents in parallel and reduces results", async () => {
    const swarm = SwarmGraph.fanOut<BaseSwarmState>({
      agents: [
        buildAgent("web", "Web results"),
        buildAgent("papers", "Paper results"),
        buildAgent("news", "News results"),
      ],
      reducer: (results) => ({
        messages: [{ role: "assistant", content: `Combined ${Object.keys(results).length} sources` }],
        done: true,
      }),
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "AI trends" });

    // All 3 agents should have contributed to agentResults
    expect(Object.keys(result.agentResults).length).toBe(3);
    expect(result.done).toBe(true);
  });

  it("each agent receives the full input state", async () => {
    const receivedTasks: string[] = [];

    const makeTracked = (id: string) => {
      const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
      g.addNode("work", async (state) => {
        receivedTasks.push(state.task);
        return { messages: [{ role: "assistant", content: id }] };
      });
      g.addEdge(START, "work");
      g.addEdge("work", END);
      return {
        id,
        role: id,
        capabilities: [],
        skeleton: g.compile() as any,
      };
    };

    const swarm = SwarmGraph.fanOut<BaseSwarmState>({
      agents: [makeTracked("a"), makeTracked("b")],
      reducer: (_results) => ({ done: true }),
    });

    const app = swarm.compile();
    await app.invoke({ task: "shared task" });

    expect(receivedTasks).toContain("shared task");
    expect(receivedTasks.length).toBe(2);
  });
});
