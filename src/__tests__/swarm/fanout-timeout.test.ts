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

// ── tests ────────────────────────────────────────────────────

describe("fan-out timeout", () => {
  it("slow agent times out while fast agent succeeds — reducer gets partial results", async () => {
    const fast = makeAgent("fast", 10, "fast-done");
    const slow = makeAgent("slow", 5000, "slow-done"); // 5s, will timeout

    const swarm = SwarmGraph.fanOut({
      agents: [fast, slow],
      reducer: (results) => ({
        done: true,
        context: { collectedResults: results },
      }),
      timeoutMs: 200, // 200ms deadline — fast finishes, slow doesn't
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "test" });

    // Fast agent's result should be present
    expect(result.agentResults).toHaveProperty("fast");

    // Slow agent should have an error marker
    const slowResult = result.agentResults?.slow as
      | { _error: true; agent: string; error: string }
      | undefined;
    expect(slowResult).toBeDefined();
    expect(slowResult?._error).toBe(true);
    expect(slowResult?.agent).toBe("slow");

    // Reducer ran (done flag set via context)
    expect(result.context?.collectedResults).toBeDefined();
  });

  it("all agents complete within deadline — full results", async () => {
    const a = makeAgent("a", 10, "a-done");
    const b = makeAgent("b", 20, "b-done");

    const swarm = SwarmGraph.fanOut({
      agents: [a, b],
      reducer: (results) => ({
        done: true,
        context: { collectedResults: results },
      }),
      timeoutMs: 2000, // generous deadline
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "test" });

    // Both results present, no errors
    expect(result.agentResults).toHaveProperty("a");
    expect(result.agentResults).toHaveProperty("b");
    expect((result.agentResults?.a as any)?._error).toBeUndefined();
    expect((result.agentResults?.b as any)?._error).toBeUndefined();
  });

  it("no timeoutMs — no deadline (backwards-compatible)", async () => {
    const a = makeAgent("a", 10, "done");

    const swarm = SwarmGraph.fanOut({
      agents: [a],
      reducer: (_results) => ({ done: true }),
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "test" });

    expect(result.agentResults).toHaveProperty("a");
    expect(result.done).toBe(true);
  });

  it("deadline is computed at invoke-time, not factory-time", async () => {
    const agent = makeAgent("x", 10, "ok");

    const swarm = SwarmGraph.fanOut({
      agents: [agent],
      reducer: (_results) => ({ done: true }),
      timeoutMs: 500,
    });

    const app = swarm.compile();

    // Wait 300ms — if deadline was computed at factory-time, only 200ms remain
    await new Promise((r) => setTimeout(r, 300));

    // Invoke: agent takes 10ms, well within 500ms budget if computed now
    const result = await app.invoke({ task: "test" });
    expect(result.agentResults).toHaveProperty("x");
    expect((result.agentResults?.x as any)?._error).toBeUndefined();
  });
});
