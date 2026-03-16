import { describe, it, expect, vi } from "vitest";
import { SwarmGraph } from "../../swarm/graph.js";
import type { SwarmAgentDef } from "../../swarm/types.js";
import type { BaseSwarmState } from "../../swarm/config.js";

function makeAgent(id: string): SwarmAgentDef<BaseSwarmState> {
  return {
    id,
    role: id,
    capabilities: [{ name: "test", description: "test" }],
    skeleton: { invoke: vi.fn(async (s: any) => s), stream: vi.fn() } as any,
    maxConcurrency: 1,
  };
}

describe("buildDag", () => {
  it("BUG-0033: should throw on circular dependencies instead of looping infinitely", () => {
    // A -> B -> A creates a cycle that, without the guard, would cause
    // the while(remaining.size > 0) loop to spin forever.
    expect(() =>
      SwarmGraph.dag<BaseSwarmState>({
        agents: [makeAgent("A"), makeAgent("B")],
        dependencies: { A: ["B"], B: ["A"] },
      }),
    ).toThrow();
  });
});
