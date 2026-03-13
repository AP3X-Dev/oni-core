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

function buildHangingSkeleton() {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async () => {
    // Hang forever (well, a long time)
    await new Promise((resolve) => setTimeout(resolve, 60_000));
    return {};
  });
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return g.compile();
}

function buildSuccessSkeleton(label: string) {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async () => ({
    messages: [{ role: "assistant", content: label }],
    done: true,
  }));
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return g.compile();
}

function buildSlowThenFastSkeleton(slowMs: number) {
  let calls = 0;
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async () => {
    calls++;
    if (calls === 1) {
      // First call hangs
      await new Promise((resolve) => setTimeout(resolve, slowMs));
    }
    return {
      messages: [{ role: "assistant", content: `completed on attempt ${calls}` }],
      done: true,
    };
  });
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return g.compile();
}

describe("Agent per-attempt timeout", () => {
  it("times out a hanging agent and falls back to supervisor", async () => {
    const swarm = new SwarmGraph<BaseSwarmState>();

    swarm.addAgent({
      id: "hanger",
      role: "Hanger",
      capabilities: [{ name: "hang", description: "hangs" }],
      skeleton: buildHangingSkeleton() as any,
      maxRetries: 0,
      timeout: 50, // 50ms — will timeout
    });

    swarm.addAgent({
      id: "backup",
      role: "Backup",
      capabilities: [{ name: "work", description: "works" }],
      skeleton: buildSuccessSkeleton("backup saved it") as any,
    });

    swarm.addSupervisor({
      strategy: "rule",
      taskField: "task",
      contextField: "context",
      maxRounds: 5,
      rules: [
        { condition: (_, ctx) => !!(ctx as any).lastAgentError, agentId: "backup" },
        { condition: () => true, agentId: "hanger" },
      ],
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "timeout test" });

    // Hanger should have timed out, supervisor falls back to backup
    expect(result.done).toBe(true);
    expect(result.messages.some((m: any) => m.content === "backup saved it")).toBe(true);
    // Hanger should be in error status
    const stats = app.registry.stats();
    expect(stats["hanger"]!.status).toBe("error");
  }, 10_000);

  it("does not timeout when agent completes within budget", async () => {
    const swarm = new SwarmGraph<BaseSwarmState>();

    swarm.addAgent({
      id: "fast",
      role: "Fast",
      capabilities: [],
      skeleton: buildSuccessSkeleton("fast result") as any,
      timeout: 5000, // 5s — plenty of time
    });

    swarm.addEdge(START, "fast");
    swarm.addConditionalHandoff("fast", () => END);

    const app = swarm.compile();
    const result = await app.invoke({ task: "fast test" });

    expect(result.done).toBe(true);
    expect(result.messages.some((m: any) => m.content === "fast result")).toBe(true);
  });

  it("retries after timeout and succeeds on next attempt", async () => {
    const swarm = new SwarmGraph<BaseSwarmState>();

    // First attempt hangs for 500ms (will timeout at 100ms), second attempt is fast
    swarm.addAgent({
      id: "flaky_slow",
      role: "FlakySlow",
      capabilities: [],
      skeleton: buildSlowThenFastSkeleton(500) as any,
      maxRetries: 2,
      timeout: 100, // 100ms per attempt
    });

    swarm.addEdge(START, "flaky_slow");
    swarm.addConditionalHandoff("flaky_slow", () => END);

    const app = swarm.compile();
    const result = await app.invoke({ task: "retry after timeout" });

    // Should succeed on second attempt (first was killed by timeout)
    expect(result.messages.some((m: any) =>
      m.content === "completed on attempt 2",
    )).toBe(true);
  }, 10_000);
});
