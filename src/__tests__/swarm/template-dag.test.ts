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

function buildTrackedAgent(id: string, order: string[]) {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async (_state) => {
    order.push(id);
    return {
      messages: [{ role: "assistant", content: `${id} done` }],
    };
  });
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return {
    id,
    role: id,
    capabilities: [],
    skeleton: g.compile() as any,
  };
}

describe("SwarmGraph.dag()", () => {
  it("linear chain: A → B → C (same as pipeline but via deps)", async () => {
    const order: string[] = [];

    const swarm = SwarmGraph.dag<BaseSwarmState>({
      agents: [
        buildTrackedAgent("A", order),
        buildTrackedAgent("B", order),
        buildTrackedAgent("C", order),
      ],
      dependencies: {
        B: ["A"],
        C: ["B"],
      },
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "linear dag" });

    // A runs first, then B, then C — strict order
    expect(order).toEqual(["A", "B", "C"]);
    // All agents should have results
    expect(Object.keys(result.agentResults)).toContain("A");
    expect(Object.keys(result.agentResults)).toContain("B");
    expect(Object.keys(result.agentResults)).toContain("C");
  });

  it("diamond: A+B parallel → C after both", async () => {
    const order: string[] = [];

    const swarm = SwarmGraph.dag<BaseSwarmState>({
      agents: [
        buildTrackedAgent("A", order),
        buildTrackedAgent("B", order),
        buildTrackedAgent("C", order),
      ],
      dependencies: {
        // A and B have no deps → run in parallel
        C: ["A", "B"], // C runs after both A and B complete
      },
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "diamond dag" });

    // A and B should both run before C
    const cIdx = order.indexOf("C");
    const aIdx = order.indexOf("A");
    const bIdx = order.indexOf("B");
    expect(aIdx).toBeLessThan(cIdx);
    expect(bIdx).toBeLessThan(cIdx);
    // All agents should have results
    expect(Object.keys(result.agentResults).sort()).toEqual(["A", "B", "C"]);
  });

  it("complex DAG: A||B parallel, C depends on A, D depends on B+C", async () => {
    const order: string[] = [];

    const swarm = SwarmGraph.dag<BaseSwarmState>({
      agents: [
        buildTrackedAgent("A", order),
        buildTrackedAgent("B", order),
        buildTrackedAgent("C", order),
        buildTrackedAgent("D", order),
      ],
      dependencies: {
        // A, B have no deps → start in parallel
        C: ["A"],       // C runs after A
        D: ["B", "C"],  // D runs after both B and C complete
      },
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "complex dag" });

    // C must come after A
    expect(order.indexOf("C")).toBeGreaterThan(order.indexOf("A"));
    // D must come after both B and C
    expect(order.indexOf("D")).toBeGreaterThan(order.indexOf("B"));
    expect(order.indexOf("D")).toBeGreaterThan(order.indexOf("C"));
    // D must be last
    expect(order.indexOf("D")).toBe(order.length - 1);
    // All agents should have results
    expect(Object.keys(result.agentResults).sort()).toEqual(["A", "B", "C", "D"]);
  });

  it("cycle detection: A→B→A throws error", () => {
    const order: string[] = [];

    expect(() => {
      SwarmGraph.dag<BaseSwarmState>({
        agents: [
          buildTrackedAgent("A", order),
          buildTrackedAgent("B", order),
        ],
        dependencies: {
          A: ["B"],
          B: ["A"],
        },
      });
    }).toThrowError(/cycle/i);
  });

  it("throws if dependency references unknown agent", () => {
    const order: string[] = [];

    expect(() => {
      SwarmGraph.dag<BaseSwarmState>({
        agents: [
          buildTrackedAgent("A", order),
        ],
        dependencies: {
          A: ["nonexistent"],
        },
      });
    }).toThrowError(/not found/i);
  });

  it("single agent with no dependencies runs and completes", async () => {
    const order: string[] = [];

    const swarm = SwarmGraph.dag<BaseSwarmState>({
      agents: [buildTrackedAgent("solo", order)],
      dependencies: {},
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "solo agent" });

    expect(order).toEqual(["solo"]);
    expect(Object.keys(result.agentResults)).toContain("solo");
  });
});
