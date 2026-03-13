import { describe, it, expect } from "vitest";
import { SwarmGraph, baseSwarmChannels, type BaseSwarmState } from "../../swarm/graph.js";
import { StateGraph } from "../../graph.js";
import { START, END } from "../../types.js";
import type { SwarmAgentDef } from "../../swarm/types.js";

// ── helpers ──────────────────────────────────────────────────

let peakConcurrency = 0;
let currentConcurrency = 0;

function resetConcurrencyTracking() {
  peakConcurrency = 0;
  currentConcurrency = 0;
}

function makeAgent(
  id: string,
  delayMs: number,
  result: string,
): SwarmAgentDef<BaseSwarmState> {
  const g = new StateGraph<BaseSwarmState>({ channels: baseSwarmChannels });
  g.addNode("work", async () => {
    currentConcurrency++;
    if (currentConcurrency > peakConcurrency) {
      peakConcurrency = currentConcurrency;
    }
    await new Promise((r) => setTimeout(r, delayMs));
    currentConcurrency--;
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
): SwarmAgentDef<BaseSwarmState> {
  const g = new StateGraph<BaseSwarmState>({ channels: baseSwarmChannels });
  g.addNode("work", async () => {
    currentConcurrency++;
    if (currentConcurrency > peakConcurrency) {
      peakConcurrency = currentConcurrency;
    }
    await new Promise((r) => setTimeout(r, delayMs));
    currentConcurrency--;
    throw new Error(`${id} failed`);
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

describe("fan-out maxConcurrency", () => {
  it("limits concurrent agent execution to maxConcurrency", async () => {
    resetConcurrencyTracking();

    // 4 agents, but only 2 at a time
    const agents = [
      makeAgent("a", 50, "a-done"),
      makeAgent("b", 50, "b-done"),
      makeAgent("c", 50, "c-done"),
      makeAgent("d", 50, "d-done"),
    ];

    const swarm = SwarmGraph.fanOut({
      agents,
      reducer: (results) => ({ done: true }),
      maxConcurrency: 2,
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "test" });

    // Peak concurrency should be at most 2
    expect(peakConcurrency).toBeLessThanOrEqual(2);
    expect(peakConcurrency).toBeGreaterThan(0);

    // All results collected
    expect(result.agentResults).toHaveProperty("a");
    expect(result.agentResults).toHaveProperty("b");
    expect(result.agentResults).toHaveProperty("c");
    expect(result.agentResults).toHaveProperty("d");
    expect(result.done).toBe(true);
  });

  it("collects all results even when batched", async () => {
    resetConcurrencyTracking();

    const agents = [
      makeAgent("x", 10, "x-result"),
      makeAgent("y", 10, "y-result"),
      makeAgent("z", 10, "z-result"),
    ];

    const swarm = SwarmGraph.fanOut({
      agents,
      reducer: (results) => ({
        done: true,
        context: { count: Object.keys(results).length },
      }),
      maxConcurrency: 1, // strictly sequential
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "test" });

    // Peak concurrency should be exactly 1
    expect(peakConcurrency).toBe(1);

    // All 3 results present
    expect(result.context?.count).toBe(3);
    expect(result.agentResults).toHaveProperty("x");
    expect(result.agentResults).toHaveProperty("y");
    expect(result.agentResults).toHaveProperty("z");
  });

  it("handles agent failures gracefully in batched mode", async () => {
    resetConcurrencyTracking();

    const agents = [
      makeAgent("good1", 10, "ok"),
      makeFailingAgent("bad", 10),
      makeAgent("good2", 10, "ok"),
    ];

    const swarm = SwarmGraph.fanOut({
      agents,
      reducer: (results) => ({
        done: true,
        context: { results },
      }),
      maxConcurrency: 2,
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "test" });

    // Good agents succeeded
    expect(result.agentResults).toHaveProperty("good1");
    expect(result.agentResults).toHaveProperty("good2");

    // Bad agent has error marker
    const badResult = result.agentResults?.bad as
      | { _error: true; agent: string; error: string }
      | undefined;
    expect(badResult?._error).toBe(true);
    expect(badResult?.agent).toBe("bad");

    // Reducer still ran
    expect(result.done).toBe(true);
  });

  it("without maxConcurrency — all agents run in parallel (backwards-compatible)", async () => {
    resetConcurrencyTracking();

    const agents = [
      makeAgent("a", 30, "done"),
      makeAgent("b", 30, "done"),
      makeAgent("c", 30, "done"),
    ];

    const swarm = SwarmGraph.fanOut({
      agents,
      reducer: (results) => ({ done: true }),
      // No maxConcurrency — default behavior
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "test" });

    // All should run in parallel (peak = 3)
    expect(peakConcurrency).toBe(3);
    expect(result.done).toBe(true);
  });
});
