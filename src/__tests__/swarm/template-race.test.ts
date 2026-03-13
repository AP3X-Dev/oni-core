import { describe, it, expect } from "vitest";
import { SwarmGraph, baseSwarmChannels, type BaseSwarmState } from "../../swarm/graph.js";
import { StateGraph } from "../../graph.js";
import { START, END } from "../../types.js";
import type { SwarmAgentDef } from "../../swarm/types.js";

// ── helpers ──────────────────────────────────────────────────

function makeAgent(
  id: string,
  delayMs: number,
  result: string,
): SwarmAgentDef<BaseSwarmState> {
  const g = new StateGraph<BaseSwarmState>({ channels: baseSwarmChannels });
  g.addNode("work", async () => {
    await new Promise((r) => setTimeout(r, delayMs));
    return { messages: [{ role: "assistant" as const, content: result }] };
  });
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return {
    id,
    role: id,
    capabilities: [],
    skeleton: g.compile(),
    maxRetries: 0,
  };
}

function makeFailingAgent(
  id: string,
  delayMs: number,
  errorMsg: string,
): SwarmAgentDef<BaseSwarmState> {
  const g = new StateGraph<BaseSwarmState>({ channels: baseSwarmChannels });
  g.addNode("work", async () => {
    await new Promise((r) => setTimeout(r, delayMs));
    throw new Error(errorMsg);
  });
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return {
    id,
    role: id,
    capabilities: [],
    skeleton: g.compile(),
    maxRetries: 0,
  };
}

// ── tests ────────────────────────────────────────────────────

describe("race topology", () => {
  it("fastest agent wins — its result is returned", async () => {
    const fast = makeAgent("fast", 10, "fast-wins");
    const slow = makeAgent("slow", 200, "slow-loses");

    const swarm = SwarmGraph.race({
      agents: [fast, slow],
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "race test" });

    // Winner should be the fast agent
    expect(result.context?.raceWinner).toBe("fast");
    expect(result.agentResults).toHaveProperty("fast");
    // Slow agent's result is discarded (not in agentResults)
  });

  it("accept predicate filters results — rejected results are skipped", async () => {
    const fast = makeAgent("fast", 10, "bad-answer");
    const slow = makeAgent("slow", 50, "good-answer");

    const swarm = SwarmGraph.race({
      agents: [fast, slow],
      accept: (agentResult) => {
        // Only accept results containing "good"
        const msgs = (agentResult as any)?.messages ?? [];
        return msgs.some((m: any) => String(m.content).includes("good"));
      },
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "race with filter" });

    // Fast agent finishes first but is rejected by accept predicate
    // Slow agent wins because it passes the predicate
    expect(result.context?.raceWinner).toBe("slow");
  });

  it("all agents fail — error is captured gracefully", async () => {
    const a = makeFailingAgent("a", 10, "a failed");
    const b = makeFailingAgent("b", 20, "b failed");

    const swarm = SwarmGraph.race({
      agents: [a, b],
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "all fail" });

    // No winner
    expect(result.context?.raceWinner).toBeUndefined();
    // Error info should be in context
    expect(result.context?.raceError).toBeDefined();
    expect(String(result.context?.raceError)).toContain("No agent produced an acceptable result");
  });

  it("race with timeoutMs — slow agents are aborted", async () => {
    const fast = makeAgent("fast", 10, "ok");
    const slow = makeAgent("slow", 5000, "too-slow");

    const swarm = SwarmGraph.race({
      agents: [fast, slow],
      timeoutMs: 200,
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "timeout test" });

    // Fast agent should win within the timeout
    expect(result.context?.raceWinner).toBe("fast");
  });
});
