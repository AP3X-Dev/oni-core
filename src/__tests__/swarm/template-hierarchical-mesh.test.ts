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

function makeAgent(id: string, output: string) {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async () => ({
    messages: [{ role: "assistant", content: output }],
  }));
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return { id, role: id, capabilities: [], skeleton: g.compile() as any };
}

describe("SwarmGraph.hierarchicalMesh()", () => {
  it("coordinator routes to team sub-graphs", async () => {
    // Coordinator picks "research" team first, then "engineering", then done
    let coordCalls = 0;
    const coordModel: ONIModel = {
      provider: "test",
      modelId: "coord",
      capabilities: { tools: false, vision: false, streaming: false, embeddings: false },
      chat: vi.fn().mockImplementation(async () => {
        coordCalls++;
        const team = coordCalls === 1 ? "research" : coordCalls === 2 ? "engineering" : "DONE";
        return {
          content: team,
          usage: { inputTokens: 5, outputTokens: 3 },
          stopReason: "end" as const,
        };
      }),
      async *stream() {},
    };

    const swarm = SwarmGraph.hierarchicalMesh<BaseSwarmState>({
      coordinator: {
        model: coordModel,
        strategy: "llm",
        maxRounds: 5,
      },
      teams: {
        research: {
          topology: "pipeline",
          agents: [
            makeAgent("searcher", "searched"),
            makeAgent("synthesizer", "synthesized"),
          ],
        },
        engineering: {
          topology: "pipeline",
          agents: [
            makeAgent("architect", "designed"),
            makeAgent("coder", "coded"),
          ],
        },
      },
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "Build a product" });

    expect(result.done).toBe(true);
    expect(coordModel.chat).toHaveBeenCalled();
  });
});
