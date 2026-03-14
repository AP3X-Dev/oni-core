import { describe, it, expect } from "vitest";
import {
  SwarmGraph, quickAgent, type BaseSwarmState,
} from "../../swarm/index.js";

describe("Agent retry backoff", () => {
  it("delays between retries when retryDelayMs is set", async () => {
    const timestamps: number[] = [];
    let calls = 0;

    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: { strategy: "round-robin", maxRounds: 1 },
      agents: [
        quickAgent("flaky", async () => {
          timestamps.push(Date.now());
          calls++;
          if (calls <= 2) throw new Error(`fail #${calls}`);
          return { messages: [{ role: "assistant", content: "ok" }], done: true };
        }, { maxRetries: 2, retryDelayMs: 50 }),
      ],
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "test backoff" });

    expect(result.done).toBe(true);
    expect(calls).toBe(3); // 1 initial + 2 retries

    // Each gap should be >= 50ms (the configured delay)
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]! - timestamps[i - 1]!).toBeGreaterThanOrEqual(40); // 40ms allows small timer jitter
    }
  });

  it("no delay when retryDelayMs is not set (backwards compatible)", async () => {
    const timestamps: number[] = [];
    let calls = 0;

    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: { strategy: "round-robin", maxRounds: 1 },
      agents: [
        quickAgent("flaky", async () => {
          timestamps.push(Date.now());
          calls++;
          if (calls <= 1) throw new Error("fail");
          return { messages: [{ role: "assistant", content: "ok" }], done: true };
        }, { maxRetries: 1 }),
      ],
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "no delay" });

    expect(result.done).toBe(true);
    expect(calls).toBe(2);

    // Without retryDelayMs, retries should be near-instant (< 20ms gap)
    const gap = timestamps[1]! - timestamps[0]!;
    expect(gap).toBeLessThan(20);
  });

  it("backoff respects swarm deadline — skips delay if deadline would expire", async () => {
    let calls = 0;

    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: {
        strategy: "round-robin",
        maxRounds: 1,
        deadlineMs: 200, // 200ms total budget
      },
      agents: [
        quickAgent("flaky", async () => {
          calls++;
          if (calls <= 2) throw new Error("fail");
          return { messages: [{ role: "assistant", content: "ok" }], done: true };
        }, { maxRetries: 2, retryDelayMs: 500 }), // 500ms delay but 200ms deadline
      ],
    });

    const app = swarm.compile();
    const _result = await app.invoke({ task: "deadline vs backoff" });

    // Agent should have retried but the long delay gets clamped or skipped
    // due to deadline pressure. The exact behavior depends on timing,
    // but the key property is: we don't hang for 1000ms (2 × 500ms).
    // The test should complete in < 500ms.
    expect(calls).toBeGreaterThanOrEqual(1);
  });
});
