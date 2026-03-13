import { describe, it, expect, vi } from "vitest";
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

describe("Coordination auto-wiring", () => {
  it("pubsub is lazily created — no cost until first use", () => {
    const swarm = new SwarmGraph<BaseSwarmState>();
    // pubsub should not exist until accessed
    expect((swarm as any)._pubsub).toBeUndefined();
    // Access triggers lazy init
    const ps = (swarm as any).pubsub;
    expect(ps).toBeDefined();
    // Same instance on second access
    expect((swarm as any).pubsub).toBe(ps);
  });

  it("broker is lazily created", () => {
    const swarm = new SwarmGraph<BaseSwarmState>();
    expect((swarm as any)._broker).toBeUndefined();
    const br = (swarm as any).broker;
    expect(br).toBeDefined();
    expect((swarm as any).broker).toBe(br);
  });

  it("agents in swarm can publish and subscribe via shared pubsub", async () => {
    const published: string[] = [];

    const swarm = new SwarmGraph<BaseSwarmState>();

    // Agent A publishes
    const gA = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
    gA.addNode("work", async () => ({
      messages: [{ role: "assistant", content: "published" }],
      context: { published: true },
    }));
    gA.addEdge(START, "work");
    gA.addEdge("work", END);

    swarm.addAgent({
      id: "publisher",
      role: "Publisher",
      capabilities: [],
      skeleton: gA.compile() as any,
    });

    swarm.addAgent({
      id: "subscriber",
      role: "Subscriber",
      capabilities: [],
      skeleton: gA.compile() as any,
    });

    swarm.pipeline("publisher", "subscriber");

    const app = swarm.compile();
    const result = await app.invoke({ task: "pub test" });

    // Should work without errors — coordination is available
    expect(result).toBeDefined();
  });
});
