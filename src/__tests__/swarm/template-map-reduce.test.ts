import { describe, it, expect } from "vitest";
import { SwarmGraph, type BaseSwarmState } from "../../swarm/index.js";
import { StateGraph, START, END, lastValue, appendList, mergeObject } from "../../index.js";

type MRState = BaseSwarmState & { documents: string[]; summary: string };

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
    documents: lastValue(() => [] as string[]),
    summary: lastValue(() => ""),
  };
}

function makeAnalyst(id: string) {
  const g = new StateGraph<MRState>({ channels: makeChannels() as any });
  g.addNode("work", async (state) => ({
    messages: [{ role: "assistant", content: `Analyzed: ${state.task}` }],
  }));
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return {
    id, role: "analyst", capabilities: [],
    skeleton: g.compile() as any,
  };
}

describe("SwarmGraph.mapReduce()", () => {
  it("splits inputs, fans out to agents, reduces results", async () => {
    const swarm = SwarmGraph.mapReduce<MRState>({
      mapper: makeAnalyst("analyst"),
      poolSize: 2,
      inputField: "documents",
      reducer: (results) => ({
        summary: `Processed ${Object.keys(results).length} items`,
        done: true,
      }),
      channels: makeChannels() as any,
    });

    const app = swarm.compile();
    const result = await app.invoke({
      task: "analyze",
      documents: ["doc1", "doc2", "doc3"],
    });

    expect(result.done).toBe(true);
    expect(result.summary).toContain("Processed");
  });
});
