/**
 * BUG-0407: When a slot drains the queue after disposal, invoke() throws
 * synchronously inside a .then continuation — next.reject was never called
 * and the caller's promise hung forever.
 *
 * Fix: replaced .then(resolve, reject) with .then(resolve).catch(reject) at
 * the three drain sites so synchronous throws are caught and forwarded.
 */

import { describe, it, expect } from "vitest";
import { AgentPool } from "../../swarm/pool.js";
import type { SwarmAgentDef } from "../../swarm/types.js";

function makeBlockingAgent(
  unblock: Promise<void>,
): SwarmAgentDef<{ v: number }> {
  return {
    id: "worker",
    role: "worker",
    capabilities: [{ name: "test", description: "test" }],
    skeleton: {
      invoke: async (input: Partial<{ v: number }>) => {
        await unblock;
        return { v: (input.v ?? 0) + 1 };
      },
      stream: async function* () {},
    } as any,
    maxConcurrency: 1,
  };
}

describe("AgentPool dispose sync throw (BUG-0407)", () => {
  it("queued promise rejects with disposed error rather than hanging when pool is disposed mid-drain", async () => {
    let unblockFirst!: () => void;
    const firstDone = new Promise<void>((r) => {
      unblockFirst = r;
    });

    const pool = new AgentPool([makeBlockingAgent(firstDone)]);

    // Fill the one slot
    const p1 = pool.invoke({ v: 1 });

    // Queue a second task — slot is at capacity
    const p2 = pool.invoke({ v: 2 });

    // Dispose while first is in-flight and second is queued
    pool.dispose();

    // p2 should reject immediately (dispose drains the queue)
    await expect(p2).rejects.toThrow("AgentPool disposed");

    // Unblock the first task — slot tries to drain but queue is empty now
    unblockFirst();

    // p1 should complete normally (was already running, not queued)
    await expect(p1).resolves.toEqual({ v: 2 });
  });

  it("invoke() after dispose rejects synchronously without hanging", async () => {
    let unblock!: () => void;
    const blocker = new Promise<void>((r) => { unblock = r; });

    const pool = new AgentPool([makeBlockingAgent(blocker)]);

    // Fill slot
    const p1 = pool.invoke({ v: 0 });

    // Dispose
    pool.dispose();

    // Any further invoke should throw synchronously (wrapped in rejected promise)
    await expect(pool.invoke({ v: 99 })).rejects.toThrow("AgentPool disposed");

    unblock();
    await p1;
  });
});
