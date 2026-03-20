import { describe, it, expect } from "vitest";
import { AgentPool } from "../../swarm/pool.js";
import type { SwarmAgentDef } from "../../swarm/types.js";

function makeAgent<S extends Record<string, unknown>>(
  id: string,
  fn: (input: Partial<S>) => Promise<S>,
  maxConcurrency = 1,
): SwarmAgentDef<S> {
  return {
    id,
    role: id,
    capabilities: [{ name: "test", description: "test" }],
    skeleton: { invoke: fn, stream: async function* () {} } as any,
    maxConcurrency,
  };
}

describe("AgentPool queue drain race (BUG-0248)", () => {
  it("BUG-0248: queued task is dispatched without double-execution when concurrent invoke() races the finally block", async () => {
    // Before the fix, runOnSlot()'s finally block used setImmediate/Promise.resolve
    // to dispatch the next queued item, creating a window where a concurrent invoke()
    // call could also pick the now-idle slot — resulting in the queued item being
    // executed twice or never. The fix makes dispatch synchronous.
    const executionLog: string[] = [];

    let resolveFirst: () => void;
    const firstStarted = new Promise<void>((r) => { resolveFirst = r; });

    const agent = makeAgent<{ tag: string; result?: string }>("worker", async (input) => {
      const tag = input.tag ?? "unknown";
      executionLog.push(`start:${tag}`);
      resolveFirst?.();
      // Simulate async work
      await new Promise<void>((r) => setTimeout(r, 10));
      executionLog.push(`end:${tag}`);
      return { tag, result: "done" };
    });

    const pool = new AgentPool([agent]); // capacity=1

    // Kick off first task (fills the slot)
    const p1 = pool.invoke({ tag: "first" });

    // Wait until the first task has started so slot is definitely occupied
    await firstStarted;

    // Enqueue second task — slot is full, so this queues
    const p2 = pool.invoke({ tag: "queued" });

    // Attempt a third invoke concurrently — this races the finally block drain
    const p3 = pool.invoke({ tag: "racing" });

    const results = await Promise.all([p1, p2, p3]);

    // All three must complete exactly once
    expect(results).toHaveLength(3);

    // Each tag should appear exactly once in start and end log entries
    const starts = executionLog.filter((e) => e.startsWith("start:")).map((e) => e.slice(6));
    const ends   = executionLog.filter((e) => e.startsWith("end:")).map((e) => e.slice(4));

    expect(starts.sort()).toEqual(["first", "queued", "racing"].sort());
    expect(ends.sort()).toEqual(["first", "queued", "racing"].sort());
  });
});
