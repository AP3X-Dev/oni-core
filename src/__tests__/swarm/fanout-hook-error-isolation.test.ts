import { describe, it, expect, vi } from "vitest";
import { SwarmGraph, baseSwarmChannels, type BaseSwarmState } from "../../swarm/graph.js";
import { StateGraph } from "../../graph.js";
import { START, END } from "../../types.js";
import type { SwarmAgentDef } from "../../swarm/types.js";

/**
 * Regression test for BUG-0301:
 *
 * In `buildFanOut` (src/swarm/factories.ts), the `onComplete` and `onError`
 * lifecycle hooks were awaited WITHOUT try/catch inside `runAgent()`.
 *
 * Before the fix:
 *   - A throwing `onComplete` hook would be caught by the surrounding `catch (err)`
 *     block and recorded as an agent error, discarding the real successful result.
 *   - A throwing `onError` hook would escape the catch block entirely, becoming an
 *     unhandled rejection and aborting the whole fan-out.
 *
 * After the fix (commit bbf3fa1):
 *   - Both hooks are wrapped in try/catch.
 *   - A throwing `onComplete` only logs a warning; the successful result is returned.
 *   - A throwing `onError` only logs a warning; the original agent error is returned.
 *
 * Verified by commit 1132abd (Merge bugfix/BUG-0301) on main.
 */

type S = BaseSwarmState;

function makeSuccessAgent(id: string): SwarmAgentDef<S> {
  const g = new StateGraph<S>({ channels: baseSwarmChannels });
  g.addNode("work", async () => ({
    messages: [{ role: "assistant" as const, content: `${id}-done` }],
  }));
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

function makeFailingAgent(id: string): SwarmAgentDef<S> {
  const g = new StateGraph<S>({ channels: baseSwarmChannels });
  g.addNode("work", async () => {
    throw new Error(`${id}-failed`);
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

describe("BUG-0301: fanout hook errors are isolated and do not corrupt agent results", () => {
  it("throwing onComplete hook does not convert a successful result into an agent error", async () => {
    const agent = makeSuccessAgent("writer");
    agent.hooks = {
      onComplete: vi.fn().mockRejectedValue(new Error("onComplete exploded")),
    };

    const swarm = SwarmGraph.fanOut<S>({
      agents: [agent],
      reducer: (results) => ({ context: { collected: results } }),
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "do work" });

    // Agent succeeded — result must NOT have _error marker
    const agentResult = result.agentResults?.writer as
      | { _error?: boolean; agent?: string }
      | undefined;

    expect(agentResult).toBeDefined();
    expect(agentResult?._error).toBeUndefined();

    // onComplete was called
    expect(agent.hooks?.onComplete).toHaveBeenCalledOnce();
  });

  it("throwing onError hook does not escalate to an unhandled rejection — original error is preserved", async () => {
    const agent = makeFailingAgent("analyst");
    agent.hooks = {
      onError: vi.fn().mockRejectedValue(new Error("onError also exploded")),
    };

    const swarm = SwarmGraph.fanOut<S>({
      agents: [agent],
      reducer: (results) => ({ context: { collected: results } }),
    });

    const app = swarm.compile();

    // Should NOT throw — onError error is swallowed, original error is captured
    const result = await expect(app.invoke({ task: "do work" })).resolves.toBeDefined();

    // onError was called once
    expect(agent.hooks?.onError).toHaveBeenCalledOnce();
  });

  it("throwing onComplete in one agent does not affect a concurrent sibling's result", async () => {
    const agentA = makeSuccessAgent("a");
    const agentB = makeSuccessAgent("b");

    agentA.hooks = {
      onComplete: vi.fn().mockRejectedValue(new Error("a-onComplete-threw")),
    };
    // agentB has no hooks — should complete cleanly

    const swarm = SwarmGraph.fanOut<S>({
      agents: [agentA, agentB],
      reducer: (results) => ({ context: { collected: results } }),
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "parallel work" });

    // Both agents should have real results, not error markers
    const aResult = result.agentResults?.a as { _error?: boolean } | undefined;
    const bResult = result.agentResults?.b as { _error?: boolean } | undefined;

    expect(aResult?._error).toBeUndefined();
    expect(bResult?._error).toBeUndefined();
  });
});
