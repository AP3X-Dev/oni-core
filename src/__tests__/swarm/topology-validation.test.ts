import { describe, it, expect } from "vitest";
import {
  SwarmGraph,
  type BaseSwarmState,
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

function buildSkeleton() {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async () => ({ done: true }));
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return g.compile();
}

describe("Topology validation", () => {
  it("detects orphan agents with no edges in non-supervised swarm", () => {
    const swarm = new SwarmGraph<BaseSwarmState>();

    swarm.addAgent({
      id: "wired",
      role: "Wired",
      capabilities: [],
      skeleton: buildSkeleton() as any,
    });
    swarm.addAgent({
      id: "orphan",
      role: "Orphan",
      capabilities: [],
      skeleton: buildSkeleton() as any,
    });

    // Only wire "wired", leave "orphan" disconnected
    swarm.addEdge(START, "wired");
    swarm.addConditionalHandoff("wired", () => END);

    const issues = swarm.validateTopology();
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.includes("orphan"))).toBe(true);
  });

  it("returns no issues for a properly wired pipeline", () => {
    const swarm = SwarmGraph.pipeline<BaseSwarmState>({
      stages: [
        { id: "a", role: "A", capabilities: [], skeleton: buildSkeleton() as any },
        { id: "b", role: "B", capabilities: [], skeleton: buildSkeleton() as any },
      ],
    });

    const issues = swarm.validateTopology();
    expect(issues).toEqual([]);
  });

  it("supervised swarms pass validation (agents reachable via Command.goto)", () => {
    const swarm = new SwarmGraph<BaseSwarmState>();

    swarm.addAgent({
      id: "worker1",
      role: "Worker1",
      capabilities: [],
      skeleton: buildSkeleton() as any,
    });
    swarm.addAgent({
      id: "worker2",
      role: "Worker2",
      capabilities: [],
      skeleton: buildSkeleton() as any,
    });

    swarm.addSupervisor({
      strategy: "round-robin",
      taskField: "task",
      maxRounds: 3,
    });

    // Supervised: all agents are reachable via supervisor routing
    const issues = swarm.validateTopology();
    expect(issues).toEqual([]);
  });
});
