import { describe, it, expect } from "vitest";
import {
  SwarmGraph, quickAgent, type BaseSwarmState,
} from "../../swarm/index.js";

describe("Deadline propagation", () => {
  it("supervisor ends immediately when swarm deadline has expired", async () => {
    const invoked: string[] = [];

    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: {
        strategy: "round-robin",
        maxRounds: 5,
        // 1ms deadline — will expire almost immediately after invoke starts
        deadlineMs: 1,
      },
      agents: [
        quickAgent("worker", async () => {
          // Small delay to ensure deadline expires before agent completes
          await new Promise((r) => setTimeout(r, 10));
          invoked.push("worker");
          return { messages: [{ role: "assistant", content: "done" }], done: true };
        }),
      ],
    });

    const app = swarm.compile();

    const result = await app.invoke({ task: "test deadline" });

    // Deadline of 1ms expires quickly — supervisor detects on second round
    expect(result.done).toBeFalsy();
  });

  it("agent effective timeout is clamped to remaining deadline", async () => {
    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: {
        strategy: "round-robin",
        maxRounds: 1,
        // 100ms deadline for the whole swarm
        deadlineMs: 100,
      },
      agents: [
        quickAgent("slow", async () => {
          // Sleep longer than the deadline
          await new Promise((r) => setTimeout(r, 500));
          return { messages: [{ role: "assistant", content: "done" }], done: true };
        }, { timeout: 60_000 }), // Agent's own timeout is 60s — but deadline clamps it
      ],
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "test clamped timeout" });

    // Agent should have timed out (deadline expired before agent finished)
    // Error falls back to supervisor which then goes to END (round 2 > maxRounds=1)
    // or supervisor detects deadline and goes to END
    expect(result.done).toBeFalsy();
  });

  it("no deadline — backwards compatible", async () => {
    const invoked: string[] = [];

    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: {
        strategy: "round-robin",
        maxRounds: 1,
        // No deadlineMs — should work exactly as before
      },
      agents: [
        quickAgent("worker", async () => {
          invoked.push("worker");
          return { messages: [{ role: "assistant", content: "done" }], done: true };
        }),
      ],
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "test no deadline" });

    expect(invoked).toContain("worker");
    expect(result.done).toBe(true);
  });
});
