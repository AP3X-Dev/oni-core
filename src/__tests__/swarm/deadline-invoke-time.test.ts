import { describe, it, expect } from "vitest";
import {
  SwarmGraph, quickAgent, type BaseSwarmState,
} from "../../swarm/index.js";

describe("Deadline computed at invoke-time (not factory-time)", () => {
  it("delay between compile and invoke does not shorten the deadline", async () => {
    const invoked: string[] = [];

    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: {
        strategy: "round-robin",
        maxRounds: 1,
        // 500ms deadline — plenty of time for a fast agent
        deadlineMs: 500,
      },
      agents: [
        quickAgent("worker", async () => {
          invoked.push("worker");
          return { messages: [{ role: "assistant", content: "done" }], done: true };
        }),
      ],
    });

    const app = swarm.compile();

    // Wait 200ms between compile and invoke — under the old (buggy) behavior
    // this would eat into the 500ms deadline. With the fix, invoke resets the clock.
    await new Promise((r) => setTimeout(r, 200));

    const result = await app.invoke({ task: "delayed invoke" });

    // Agent should still have been invoked — deadline starts at invoke(), not compile()
    expect(invoked).toContain("worker");
    expect(result.done).toBe(true);
  });

  it("invoking the same compiled skeleton twice gives both invocations a full deadline", async () => {
    let invokeCount = 0;

    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: {
        strategy: "round-robin",
        maxRounds: 1,
        // 200ms deadline — enough for a fast agent
        deadlineMs: 200,
      },
      agents: [
        quickAgent("worker", async () => {
          invokeCount++;
          return { messages: [{ role: "assistant", content: `run ${invokeCount}` }], done: true };
        }),
      ],
    });

    const app = swarm.compile();

    // First invocation
    const result1 = await app.invoke({ task: "first invoke" });
    expect(result1.done).toBe(true);

    // Wait 100ms between invocations — under the old bug, the second invocation
    // would have less remaining deadline. With the fix, both get a full 200ms.
    await new Promise((r) => setTimeout(r, 100));

    // Second invocation — should also get a full 200ms deadline
    const result2 = await app.invoke({ task: "second invoke" });
    expect(result2.done).toBe(true);

    // Both invocations should have succeeded
    expect(invokeCount).toBe(2);
  });

  it("deadline is relative to invoke start, not construction time", async () => {
    const timestamps: { invokeStart: number; agentRan: number }[] = [];

    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: {
        strategy: "round-robin",
        maxRounds: 1,
        // 300ms deadline
        deadlineMs: 300,
      },
      agents: [
        quickAgent("worker", async () => {
          timestamps.push({ invokeStart: 0, agentRan: Date.now() });
          return { messages: [{ role: "assistant", content: "done" }], done: true };
        }),
      ],
    });

    const constructionTime = Date.now();

    const app = swarm.compile();

    // Wait 400ms — longer than the deadline itself
    // Under the old bug, the deadline (constructionTime + 300ms) would already
    // have expired by now. With the fix, the deadline starts fresh at invoke().
    await new Promise((r) => setTimeout(r, 400));

    const _invokeStart = Date.now();
    timestamps.length = 0;

    const result = await app.invoke({ task: "late invoke" });

    // Agent should have run — deadline is relative to invoke(), not construction
    expect(timestamps).toHaveLength(1);
    expect(result.done).toBe(true);

    // Verify that the agent ran AFTER the old deadline would have expired
    const elapsedSinceConstruction = timestamps[0]!.agentRan - constructionTime;
    expect(elapsedSinceConstruction).toBeGreaterThan(300);
  });

  it("deadline still enforced within a single invocation", async () => {
    const invoked: string[] = [];

    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: {
        strategy: "round-robin",
        maxRounds: 10,
        // 50ms deadline — agent sleeps 200ms, so deadline should fire
        deadlineMs: 50,
      },
      agents: [
        quickAgent("slow", async () => {
          await new Promise((r) => setTimeout(r, 200));
          invoked.push("slow");
          return { messages: [{ role: "assistant", content: "done" }], done: true };
        }, { timeout: 60_000 }),
      ],
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "tight deadline" });

    // Deadline should still be enforced — agent is too slow
    expect(result.done).toBeFalsy();
  });
});
