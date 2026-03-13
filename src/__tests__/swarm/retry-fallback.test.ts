import { describe, it, expect, vi } from "vitest";
import {
  SwarmGraph,
  type BaseSwarmState,
} from "../../swarm/index.js";
import { StateGraph, START, END, lastValue, appendList, mergeObject, Command } from "../../index.js";

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

function buildFailingSkeleton(failCount: number) {
  let calls = 0;
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async () => {
    calls++;
    if (calls <= failCount) throw new Error(`Fail #${calls}`);
    return { messages: [{ role: "assistant", content: "Success after retries" }] };
  });
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return g.compile();
}

function buildAlwaysFailSkeleton() {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async () => { throw new Error("Always fails"); });
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return g.compile();
}

function buildSuccessSkeleton() {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async () => ({
    messages: [{ role: "assistant", content: "Fallback succeeded" }],
    done: true,
  }));
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return g.compile();
}

describe("Retry-then-fallback", () => {
  it("retries failed agent up to maxRetries then falls back to supervisor", async () => {
    const swarm = new SwarmGraph<BaseSwarmState>();

    swarm.addAgent({
      id: "flaky",
      role: "Flaky",
      capabilities: [{ name: "do", description: "does" }],
      skeleton: buildAlwaysFailSkeleton() as any,
      maxRetries: 1,
    });

    swarm.addAgent({
      id: "reliable",
      role: "Reliable",
      capabilities: [{ name: "do", description: "does" }],
      skeleton: buildSuccessSkeleton() as any,
    });

    // Supervisor with rules: try flaky first, then reliable on error
    swarm.addSupervisor({
      strategy: "rule",
      taskField: "task",
      contextField: "context",
      maxRounds: 5,
      rules: [
        {
          condition: (_, ctx) => !!(ctx as any).lastAgentError,
          agentId: "reliable",
        },
        { condition: () => true, agentId: "flaky" },
      ],
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "retry test" });

    // Should eventually succeed via reliable agent
    expect(result.done).toBe(true);
    expect(result.messages.some((m: any) => m.content === "Fallback succeeded")).toBe(true);
  });

  it("agent succeeds after transient failure within retry budget", async () => {
    const swarm = new SwarmGraph<BaseSwarmState>();

    // Fails once, succeeds on retry
    swarm.addAgent({
      id: "transient",
      role: "Transient",
      capabilities: [],
      skeleton: buildFailingSkeleton(1) as any,
      maxRetries: 2,
    });

    swarm.addEdge(START, "transient");
    swarm.addConditionalHandoff("transient", () => END);

    const app = swarm.compile();
    const result = await app.invoke({ task: "transient test" });

    expect(result.messages.some((m: any) => m.content === "Success after retries")).toBe(true);
  });
});
