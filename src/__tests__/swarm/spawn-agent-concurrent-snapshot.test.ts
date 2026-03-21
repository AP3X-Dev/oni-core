import { describe, it, expect } from "vitest";
import {
  SwarmGraph, quickAgent, type BaseSwarmState,
} from "../../swarm/index.js";

describe("BUG-0349: spawnAgent() concurrent mutation does not corrupt superstep iteration", () => {
  it("BUG-0349: execution completes without error when spawnAgent() is called mid-execution", async () => {
    // Before the fix: streamSupersteps iterated ctx.nodes directly. A concurrent
    // spawnAgent() call could add entries to the map mid-iteration, causing the
    // superstep to attempt to execute a node that was not part of the planned
    // batch — potentially leading to NodeNotFoundError or silently skipped routing.
    //
    // After the fix: a nodesSnapshot = new Map(ctx.nodes) is taken at the start
    // of each superstep, isolating the iteration from concurrent mutations.
    //
    // This test exercises the concurrent mutation scenario and verifies correct completion.

    let resolveWorker!: () => void;
    const workerPaused = new Promise<void>((res) => { resolveWorker = res; });
    let resumeWorker!: () => void;
    const workerResume = new Promise<void>((res) => { resumeWorker = res; });

    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: {
        strategy: "rule",
        rules: [
          { condition: () => true, agentId: "worker" },
        ],
        maxRounds: 2,
      },
      agents: [
        quickAgent("worker", async (_state) => {
          // Signal that the worker is executing inside a superstep
          resolveWorker();
          // Wait for the test to trigger spawnAgent() while we're mid-execution
          await workerResume;
          return {
            messages: [{ role: "assistant", content: "worker done" }],
            done: true,
          };
        }),
      ],
    });

    const app = swarm.compile();

    // Start execution in the background
    const executionPromise = app.invoke({ task: "test concurrent spawn" });

    // Wait until the worker node is executing (inside a superstep)
    await workerPaused;

    // Call spawnAgent() while the superstep is in progress.
    // Before the fix, this could mutate ctx.nodes mid-iteration, causing
    // NodeNotFoundError or other runtime corruption. The snapshot fix isolates
    // the current superstep from seeing this new node.
    expect(() => {
      app.spawnAgent(
        quickAgent("late-agent", async () => ({
          messages: [{ role: "assistant", content: "late" }],
          done: false,
        })),
      );
    }).not.toThrow();

    // Resume the worker so execution can complete
    resumeWorker();

    // Execution must complete without NodeNotFoundError or other crash
    const result = await executionPromise;

    expect(result.done).toBe(true);
    expect(result.messages.some(
      (m: { content: string }) => m.content.includes("worker done"),
    )).toBe(true);
  });

  it("BUG-0349: removeAgent() called mid-execution does not disrupt the running superstep", async () => {
    // removeAgent() deletes from ctx.nodes. Without the snapshot, a superstep
    // that has already captured a node for execution could lose its NodeDef lookup
    // if removeAgent() races in before the lookup completes.
    let resolveWorker!: () => void;
    const workerPaused = new Promise<void>((res) => { resolveWorker = res; });
    let resumeWorker!: () => void;
    const workerResume = new Promise<void>((res) => { resumeWorker = res; });

    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: {
        strategy: "rule",
        rules: [
          { condition: () => true, agentId: "primary" },
        ],
        maxRounds: 2,
      },
      agents: [
        quickAgent("primary", async (_state) => {
          resolveWorker();
          await workerResume;
          return {
            messages: [{ role: "assistant", content: "primary done" }],
            done: true,
          };
        }),
        quickAgent("secondary", async () => ({
          messages: [{ role: "assistant", content: "secondary" }],
          done: false,
        })),
      ],
    });

    const app = swarm.compile();
    const executionPromise = app.invoke({ task: "test concurrent remove" });

    await workerPaused;

    // Remove secondary while primary is mid-execution
    expect(() => app.removeAgent("secondary")).not.toThrow();

    resumeWorker();

    const result = await executionPromise;
    expect(result.done).toBe(true);
    expect(result.messages.some(
      (m: { content: string }) => m.content.includes("primary done"),
    )).toBe(true);
  });

  it("BUG-0349: spawnAgent() followed by invoke() on the same app produces correct results for both runs", async () => {
    // This verifies that the nodes map is stable across multiple sequential invocations
    // even after dynamic agents are added — the snapshot is a new Map each superstep,
    // so stale snapshots from one invocation cannot pollute another.
    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: {
        strategy: "rule",
        rules: [
          { condition: (task) => task.includes("dynamic"), agentId: "dynamic" },
          { condition: () => true, agentId: "static" },
        ],
        maxRounds: 2,
      },
      agents: [
        quickAgent("static", async () => ({
          messages: [{ role: "assistant", content: "static handled" }],
          done: true,
        })),
      ],
    });

    const app = swarm.compile();

    // First invocation — no dynamic agent yet
    const result1 = await app.invoke({ task: "static task" });
    expect(result1.done).toBe(true);
    expect(result1.messages.some(
      (m: { content: string }) => m.content.includes("static handled"),
    )).toBe(true);

    // Add dynamic agent between invocations
    app.spawnAgent(
      quickAgent("dynamic", async () => ({
        messages: [{ role: "assistant", content: "dynamic handled" }],
        done: true,
      })),
    );

    // Second invocation — dynamic agent is now available
    const result2 = await app.invoke({ task: "dynamic task" });
    expect(result2.done).toBe(true);
    expect(result2.messages.some(
      (m: { content: string }) => m.content.includes("dynamic handled"),
    )).toBe(true);
  });
});
