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
    approved: lastValue(() => false),
  };
}

type PeerState = BaseSwarmState & { approved: boolean };

function makeAgent(id: string, effect: (state: any) => Partial<PeerState>) {
  const g = new StateGraph<PeerState>({ channels: makeChannels() as any });
  g.addNode("work", async (state) => effect(state));
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return {
    id, role: id, capabilities: [],
    skeleton: g.compile() as any,
  };
}

describe("SwarmGraph.peerNetwork()", () => {
  it("routes agents to each other based on handoff map", async () => {
    const order: string[] = [];

    const swarm = SwarmGraph.peerNetwork<PeerState>({
      agents: [
        makeAgent("planner", () => { order.push("planner"); return { messages: [{ role: "assistant", content: "planned" }] }; }),
        makeAgent("coder", () => { order.push("coder"); return { messages: [{ role: "assistant", content: "coded" }] }; }),
        makeAgent("reviewer", () => { order.push("reviewer"); return { approved: true, done: true }; }),
      ],
      entrypoint: "planner",
      handoffs: {
        planner: () => "coder",
        coder: () => "reviewer",
        reviewer: (state) => state.done ? END : "coder",
      },
      channels: makeChannels() as any,
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "peer test" });

    expect(order).toEqual(["planner", "coder", "reviewer"]);
    expect(result.done).toBe(true);
  });

  it("supports looping back on rejection", async () => {
    let reviewCount = 0;

    const swarm = SwarmGraph.peerNetwork<PeerState>({
      agents: [
        makeAgent("writer", () => ({
          messages: [{ role: "assistant", content: "wrote" }],
        })),
        makeAgent("reviewer", () => {
          reviewCount++;
          return {
            approved: reviewCount >= 2,
            done: reviewCount >= 2,
          };
        }),
      ],
      entrypoint: "writer",
      handoffs: {
        writer: () => "reviewer",
        reviewer: (state) => state.done ? END : "writer",
      },
      channels: makeChannels() as any,
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "loop test" });

    expect(result.done).toBe(true);
    expect(reviewCount).toBe(2);
  });
});
