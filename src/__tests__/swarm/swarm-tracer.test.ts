import { describe, it, expect } from "vitest";
import {
  SwarmGraph, SwarmTracer, type BaseSwarmState,
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

function buildSkeleton(response: string) {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async () => ({
    messages: [{ role: "assistant", content: response }],
  }));
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return g.compile() as any;
}

function buildFailingSkeleton() {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async () => { throw new Error("boom"); });
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return g.compile() as any;
}

describe("SwarmTracer", () => {
  it("instrument() records agent_start and agent_complete events", async () => {
    const tracer = new SwarmTracer();

    const agents = tracer.instrument([
      { id: "alpha", role: "Alpha", capabilities: [], skeleton: buildSkeleton("done") },
      { id: "beta", role: "Beta", capabilities: [], skeleton: buildSkeleton("also done") },
    ]);

    const swarm = SwarmGraph.pipeline<BaseSwarmState>({ stages: agents });
    const app = swarm.compile();
    await app.invoke({ task: "traced pipeline" });

    const timeline = tracer.getTimeline();

    // Should have 4 events: start+complete for each agent
    expect(timeline.length).toBe(4);
    expect(timeline[0]!.type).toBe("agent_start");
    expect(timeline[0]!.agentId).toBe("alpha");
    expect(timeline[1]!.type).toBe("agent_complete");
    expect(timeline[1]!.agentId).toBe("alpha");
    expect(timeline[2]!.type).toBe("agent_start");
    expect(timeline[2]!.agentId).toBe("beta");
    expect(timeline[3]!.type).toBe("agent_complete");
    expect(timeline[3]!.agentId).toBe("beta");

    // Timestamps should be monotonically non-decreasing
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i]!.timestamp).toBeGreaterThanOrEqual(timeline[i - 1]!.timestamp);
    }
  });

  it("records agent_error events with error data", async () => {
    const tracer = new SwarmTracer();

    const agents = tracer.instrument([
      { id: "flaky", role: "Flaky", capabilities: [], skeleton: buildFailingSkeleton(), maxRetries: 0 },
    ]);

    const swarm = new SwarmGraph<BaseSwarmState>();
    swarm.addAgent(agents[0]!);
    swarm.addEdge(START, "flaky");
    swarm.addConditionalHandoff("flaky", () => END);

    const app = swarm.compile();
    await expect(app.invoke({ task: "fail" })).rejects.toThrow();

    const timeline = tracer.getTimeline();
    expect(timeline.length).toBe(2); // start + error
    expect(timeline[0]!.type).toBe("agent_start");
    expect(timeline[1]!.type).toBe("agent_error");
    expect(timeline[1]!.agentId).toBe("flaky");
    expect(timeline[1]!.data).toBeInstanceOf(Error);
  });

  it("getAgentEvents filters by agent and clear() resets", async () => {
    const tracer = new SwarmTracer();

    const agents = tracer.instrument([
      { id: "a", role: "A", capabilities: [], skeleton: buildSkeleton("A") },
      { id: "b", role: "B", capabilities: [], skeleton: buildSkeleton("B") },
    ]);

    const swarm = SwarmGraph.pipeline<BaseSwarmState>({ stages: agents });
    const app = swarm.compile();
    await app.invoke({ task: "filter test" });

    // Filter by agent
    const aEvents = tracer.getAgentEvents("a");
    expect(aEvents.length).toBe(2);
    expect(aEvents.every(e => e.agentId === "a")).toBe(true);

    const bEvents = tracer.getAgentEvents("b");
    expect(bEvents.length).toBe(2);

    // Clear resets
    tracer.clear();
    expect(tracer.getTimeline().length).toBe(0);
  });
});
