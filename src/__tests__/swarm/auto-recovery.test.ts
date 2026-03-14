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

function buildAlwaysFailSkeleton() {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async () => { throw new Error("Always fails"); });
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

describe("Supervisor auto-recovery", () => {
  it("auto-recovers to idle agent with matching capability when autoRecover is enabled", async () => {
    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: {
        strategy: "rule",
        maxRounds: 5,
        rules: [
          // First rule always routes to "primary" (before it errors out)
          { condition: () => true, agentId: "primary" },
        ],
      },
      agents: [
        {
          id: "primary",
          role: "Primary Coder",
          capabilities: [{ name: "coding", description: "writes code" }],
          skeleton: buildAlwaysFailSkeleton() as any,
          maxRetries: 0,
        },
        {
          id: "backup_coder",
          role: "Backup Coder",
          capabilities: [{ name: "coding", description: "also writes code" }],
          skeleton: buildSuccessSkeleton("backup handled it") as any,
        },
        {
          id: "researcher",
          role: "Researcher",
          capabilities: [{ name: "research", description: "does research" }],
          skeleton: buildSuccessSkeleton("researched") as any,
        },
      ],
      onError: "fallback",
    });

    // Enable auto-recovery on the supervisor config
    // This is tested via the supervisor config option
    const _app = swarm.compile();

    // Without autoRecover, supervisor rule would route back to "primary" (still error)
    // or END. With autoRecover, supervisor should detect lastAgentError and route to
    // an idle agent with matching "coding" capability — that's "backup_coder", not "researcher".
    //
    // But we need to enable autoRecover first. Since we can't change the supervisor config
    // after creation, we test this via the createSupervisorNode directly.
    // For the integration test, we use the hierarchical template which we'll enhance.

    // For now, let's test via a manual swarm setup with autoRecover enabled
    const swarm2 = new SwarmGraph<BaseSwarmState>();

    swarm2.addAgent({
      id: "primary",
      role: "Primary Coder",
      capabilities: [{ name: "coding", description: "writes code" }],
      skeleton: buildAlwaysFailSkeleton() as any,
      maxRetries: 0,
    });
    swarm2.addAgent({
      id: "backup_coder",
      role: "Backup Coder",
      capabilities: [{ name: "coding", description: "also writes code" }],
      skeleton: buildSuccessSkeleton("backup handled it") as any,
    });
    swarm2.addAgent({
      id: "researcher",
      role: "Researcher",
      capabilities: [{ name: "research", description: "does research" }],
      skeleton: buildSuccessSkeleton("researched") as any,
    });

    swarm2.addSupervisor({
      strategy: "rule",
      taskField: "task",
      contextField: "context",
      maxRounds: 5,
      autoRecover: true,
      rules: [
        { condition: () => true, agentId: "primary" },
      ],
    });

    const app2 = swarm2.compile();
    const result = await app2.invoke({ task: "write some code" });

    // Should auto-recover to backup_coder (matching "coding" capability), not researcher
    expect(result.done).toBe(true);
    expect(result.messages.some((m: any) => m.content === "backup handled it")).toBe(true);
  });

  it("falls through to normal routing when no capable agent is idle", async () => {
    const swarm = new SwarmGraph<BaseSwarmState>();

    swarm.addAgent({
      id: "sole_coder",
      role: "Sole Coder",
      capabilities: [{ name: "coding", description: "writes code" }],
      skeleton: buildAlwaysFailSkeleton() as any,
      maxRetries: 0,
    });
    swarm.addAgent({
      id: "researcher",
      role: "Researcher",
      capabilities: [{ name: "research", description: "does research" }],
      skeleton: buildSuccessSkeleton("researcher fallback") as any,
    });

    swarm.addSupervisor({
      strategy: "rule",
      taskField: "task",
      contextField: "context",
      maxRounds: 5,
      autoRecover: true,
      rules: [
        // After error, no "coding" capable agent is idle → falls through to rules
        { condition: (_, ctx) => !!(ctx as any).lastAgentError, agentId: "researcher" },
        { condition: () => true, agentId: "sole_coder" },
      ],
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "write code" });

    // sole_coder fails, no other "coding" agent → falls through to rule routing → researcher
    expect(result.done).toBe(true);
    expect(result.messages.some((m: any) => m.content === "researcher fallback")).toBe(true);
  });

  it("does not auto-recover when autoRecover is not set (default behavior)", async () => {
    const swarm = new SwarmGraph<BaseSwarmState>();

    swarm.addAgent({
      id: "primary",
      role: "Primary",
      capabilities: [{ name: "coding", description: "writes code" }],
      skeleton: buildAlwaysFailSkeleton() as any,
      maxRetries: 0,
    });
    swarm.addAgent({
      id: "backup",
      role: "Backup",
      capabilities: [{ name: "coding", description: "also writes code" }],
      skeleton: buildSuccessSkeleton("backup worked") as any,
    });

    swarm.addSupervisor({
      strategy: "rule",
      taskField: "task",
      contextField: "context",
      maxRounds: 5,
      // autoRecover is NOT set — should use default (false)
      rules: [
        // No error-aware rule → supervisor re-routes to primary (loops/fails)
        { condition: () => true, agentId: "primary" },
      ],
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "write code" });

    // Without autoRecover, the rule keeps routing to "primary" which keeps failing.
    // Eventually maxRounds is hit and supervisor ENDs.
    // Backup should NOT have been invoked.
    expect(result.messages.every((m: any) => m.content !== "backup worked")).toBe(true);
  });
});
