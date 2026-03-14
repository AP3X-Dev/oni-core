import { describe, it, expect, vi } from "vitest";
import { AgentPool } from "../../swarm/pool.js";
import type { SwarmAgentDef } from "../../swarm/types.js";

function makeAgent<S extends Record<string, unknown>>(
  id: string,
  fn: (input: Partial<S>, config?: any) => Promise<S>,
  maxConcurrency = 1,
): SwarmAgentDef<S> {
  return {
    id,
    role: id,
    capabilities: [{ name: "test", description: "test" }],
    skeleton: { invoke: fn, stream: vi.fn() } as any,
    maxConcurrency,
  };
}

describe("AgentPool", () => {
  it("routes to least-busy agent under concurrent load", async () => {
    const calls: string[] = [];
    const a = makeAgent("a", async (inp) => {
      calls.push("a");
      await new Promise((r) => setTimeout(r, 20));
      return inp as any;
    });
    const b = makeAgent("b", async (inp) => {
      calls.push("b");
      await new Promise((r) => setTimeout(r, 20));
      return inp as any;
    });

    const pool = new AgentPool([a, b]);
    // Fire concurrently so least-busy routing distributes across both
    await Promise.all([
      pool.invoke({ task: "1" } as any),
      pool.invoke({ task: "2" } as any),
    ]);

    // Both agents should have been used
    expect(calls).toContain("a");
    expect(calls).toContain("b");
  });

  it("batch() rejects entirely if any agent fails (Promise.all behavior)", async () => {
    let callCount = 0;
    const agent = makeAgent("worker", async () => {
      callCount++;
      if (callCount === 2) throw new Error("Agent 2 failed");
      return { result: callCount } as any;
    }, 3);

    const pool = new AgentPool([agent]);

    await expect(
      pool.batch([{ task: "1" }, { task: "2" }, { task: "3" }] as any[])
    ).rejects.toThrow("Agent 2 failed");
  });

  it("batchSettled() returns all results even when some agents fail", async () => {
    let callCount = 0;
    const agent = makeAgent("worker", async () => {
      callCount++;
      if (callCount === 2) throw new Error("Agent 2 failed");
      return { result: callCount } as any;
    }, 5);

    const pool = new AgentPool([agent]);

    const results = await pool.batchSettled(
      [{ task: "1" }, { task: "2" }, { task: "3" }] as any[]
    );

    expect(results).toHaveLength(3);

    // First and third should succeed
    expect(results[0]!.status).toBe("fulfilled");
    expect((results[0] as PromiseFulfilledResult<any>).value.result).toBe(1);

    // Second should fail
    expect(results[1]!.status).toBe("rejected");
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
    expect((results[1] as PromiseRejectedResult).reason.message).toBe("Agent 2 failed");

    // Third should succeed
    expect(results[2]!.status).toBe("fulfilled");
    expect((results[2] as PromiseFulfilledResult<any>).value.result).toBe(3);
  });

  it("respects concurrency limits and queues excess work", async () => {
    const concurrent: number[] = [];
    let active = 0;

    const agent = makeAgent("worker", async (inp) => {
      active++;
      concurrent.push(active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return inp as any;
    }, 2); // maxConcurrency = 2

    const pool = new AgentPool([agent]);

    // Fire 4 tasks — only 2 should run concurrently
    await Promise.all([
      pool.invoke({ task: "1" } as any),
      pool.invoke({ task: "2" } as any),
      pool.invoke({ task: "3" } as any),
      pool.invoke({ task: "4" } as any),
    ]);

    // Peak concurrency should never exceed 2
    expect(Math.max(...concurrent)).toBeLessThanOrEqual(2);
  });

  it("processes higher-priority queued tasks before lower-priority ones", async () => {
    const order: string[] = [];

    const agent = makeAgent("worker", async (inp: any) => {
      await new Promise((r) => setTimeout(r, 10));
      order.push(inp.task);
      return inp;
    }, 1); // maxConcurrency = 1

    const pool = new AgentPool([agent]);

    // Fill the slot with a running task
    const p0 = pool.invoke({ task: "running" } as any);

    // Queue 3 tasks with different priorities — they'll be queued because slot is full
    const pLow = pool.invoke({ task: "low" } as any, undefined, "low");
    const pNormal = pool.invoke({ task: "normal" } as any, undefined, "normal");
    const pCritical = pool.invoke({ task: "critical" } as any, undefined, "critical");

    await Promise.all([p0, pLow, pNormal, pCritical]);

    // After "running" completes, queued tasks should drain in priority order:
    // critical → normal → low
    expect(order).toEqual(["running", "critical", "normal", "low"]);
  });

  it("least-busy single-pass: selects correct agent with mixed concurrency", async () => {
    // Agent A: maxConcurrency 3, Agent B: maxConcurrency 1
    // Fire 3 tasks simultaneously — A should take 2, B should take 1
    // (B fills up on first task, remaining go to A)
    const taskCounts = { a: 0, b: 0 };

    const a = makeAgent("a", async (inp) => {
      taskCounts.a++;
      await new Promise((r) => setTimeout(r, 10));
      return inp as any;
    }, 3);
    const b = makeAgent("b", async (inp) => {
      taskCounts.b++;
      await new Promise((r) => setTimeout(r, 10));
      return inp as any;
    }, 1);

    const pool = new AgentPool([a, b]);
    await Promise.all([
      pool.invoke({ task: "1" } as any),
      pool.invoke({ task: "2" } as any),
      pool.invoke({ task: "3" } as any),
    ]);

    // Both agents should have been used
    expect(taskCounts.a).toBeGreaterThanOrEqual(1);
    expect(taskCounts.b).toBeGreaterThanOrEqual(1);
    expect(taskCounts.a + taskCounts.b).toBe(3);
  });

  it("queue drain maintains priority order with many items", async () => {
    const order: string[] = [];

    const agent = makeAgent("worker", async (inp: any) => {
      await new Promise((r) => setTimeout(r, 5));
      order.push(inp.task);
      return inp;
    }, 1);

    const pool = new AgentPool([agent]);

    // Fill the slot
    const p0 = pool.invoke({ task: "running" } as any);

    // Queue 5 tasks with mixed priorities
    const p1 = pool.invoke({ task: "low-1" } as any, undefined, "low");
    const p2 = pool.invoke({ task: "high-1" } as any, undefined, "high");
    const p3 = pool.invoke({ task: "critical-1" } as any, undefined, "critical");
    const p4 = pool.invoke({ task: "normal-1" } as any, undefined, "normal");
    const p5 = pool.invoke({ task: "high-2" } as any, undefined, "high");

    await Promise.all([p0, p1, p2, p3, p4, p5]);

    // Should drain: critical → high-1 → high-2 → normal → low
    expect(order[0]).toBe("running");
    expect(order[1]).toBe("critical-1");
    // high-1 and high-2 have same priority — either order is fine
    expect(new Set([order[2], order[3]])).toEqual(new Set(["high-1", "high-2"]));
    expect(order[4]).toBe("normal-1");
    expect(order[5]).toBe("low-1");
  });

  it("throws when queue depth is exceeded", async () => {
    const agent = makeAgent("worker", async () => {
      await new Promise((r) => setTimeout(r, 100));
      return {} as any;
    }, 1);

    const pool = new AgentPool([agent], { maxQueueDepth: 1 });

    // Fill the slot
    const p1 = pool.invoke({ task: "1" } as any);
    // Fill the queue
    const p2 = pool.invoke({ task: "2" } as any);

    // This should exceed queue depth
    await expect(pool.invoke({ task: "3" } as any)).rejects.toThrow("queue depth exceeded");

    // Clean up
    await Promise.allSettled([p1, p2]);
  });

  it("queued tasks are rerouted to remaining slots when the draining slot is removed", async () => {
    const ran: string[] = [];

    // Agent "a" is slow (holds the slot) — agent "b" will receive the queued work after "a" is removed
    const a = makeAgent("a", async (inp: any) => {
      await new Promise((r) => setTimeout(r, 30));
      ran.push(`a:${inp.task}`);
      return inp;
    }, 1);

    const b = makeAgent("b", async (inp: any) => {
      ran.push(`b:${inp.task}`);
      return inp;
    }, 1);

    const pool = new AgentPool([a, b]);

    // Fill both slots so queued work builds up, then remove "a" while it's still running
    const p1 = pool.invoke({ task: "1" } as any);  // goes to a (slow)
    const p2 = pool.invoke({ task: "2" } as any);  // goes to b (fast, completes quickly)

    // Immediately queue a third task — slot "a" is busy, slot "b" is busy initially
    // After "b" finishes p2 it will drain from the queue
    const p3 = pool.invoke({ task: "3" } as any);

    // Remove slot "a" while p1 is still running
    pool.removeSlots(["a"]);

    await Promise.all([p1, p2, p3]);

    // p1 must have run on "a" (already in-flight when removed)
    expect(ran).toContain("a:1");
    // p3 must NOT have run on "a" (a was removed before it drained)
    expect(ran.some((r) => r.startsWith("a:") && r !== "a:1")).toBe(false);
    // p3 should have been routed to "b"
    expect(ran).toContain("b:3");
  });
});
