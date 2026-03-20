// Regression test for BUG-0255
// AgentPool.batch() previously used Promise.all, which caused one failing invocation
// to cancel the entire batch and discard results from all other invocations that
// continued running as orphaned promises.
// Fix: batch() now uses Promise.allSettled internally and throws BatchError (with
// .results and .errors) when any input fails, preserving results from successful
// invocations.

import { describe, it, expect } from "vitest";
import { AgentPool, BatchError } from "../../swarm/pool.js";
import { quickAgent, type BaseSwarmState } from "../../swarm/index.js";

type S = BaseSwarmState;

function successAgent(id: string, value: string) {
  return quickAgent(id, async () => ({
    messages: [{ role: "assistant" as const, content: value }],
    done: true,
  }));
}

describe("BUG-0255: AgentPool.batch() partial failures", () => {
  it("BUG-0255: returns all results when all inputs succeed", async () => {
    const agent = successAgent("a", "ok");
    const pool = new AgentPool<S>([agent], { strategy: "round-robin" });

    const results = await pool.batch([
      { task: "input-1" } as Partial<S>,
      { task: "input-2" } as Partial<S>,
    ]);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.done)).toBe(true);
  });

  it("BUG-0255: throws BatchError when any input fails", async () => {
    let call = 0;
    const agent = quickAgent<S>("flaky", async (state) => {
      call++;
      if ((state as S).task === "bad-input") {
        throw new Error("intentional failure");
      }
      return { messages: [{ role: "assistant" as const, content: "ok" }], done: true };
    });

    const pool = new AgentPool<S>([agent]);
    const err = await pool
      .batch([
        { task: "good-input" } as Partial<S>,
        { task: "bad-input" } as Partial<S>,
      ])
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BatchError);
  });

  it("BUG-0255: BatchError.results contains successful results alongside undefined for failures", async () => {
    let invocationIndex = 0;
    const agent = quickAgent<S>("mixed", async () => {
      const idx = invocationIndex++;
      if (idx === 1) throw new Error("input-1 fails");
      return { messages: [{ role: "assistant" as const, content: `result-${idx}` }], done: true };
    });

    const pool = new AgentPool<S>([agent]);
    let batchErr: BatchError<S> | null = null;

    await pool
      .batch([
        { task: "i0" } as Partial<S>,
        { task: "i1" } as Partial<S>,
        { task: "i2" } as Partial<S>,
      ])
      .catch((e: unknown) => {
        if (e instanceof BatchError) batchErr = e;
      });

    expect(batchErr).not.toBeNull();
    expect(batchErr!.results).toHaveLength(3);
    // Input 1 failed — its result slot is undefined
    expect(batchErr!.results[1]).toBeUndefined();
    // Inputs 0 and 2 succeeded — their result slots are defined
    expect(batchErr!.results[0]).toBeDefined();
    expect(batchErr!.results[2]).toBeDefined();
  });

  it("BUG-0255: BatchError.errors contains the failure reason, undefined for successes", async () => {
    let invocationIndex = 0;
    const agent = quickAgent<S>("mixed-err", async () => {
      const idx = invocationIndex++;
      if (idx === 0) throw new Error("boom");
      return { messages: [{ role: "assistant" as const, content: "ok" }], done: true };
    });

    const pool = new AgentPool<S>([agent]);
    let batchErr: BatchError<S> | null = null;

    await pool
      .batch([
        { task: "fails" } as Partial<S>,
        { task: "succeeds" } as Partial<S>,
      ])
      .catch((e: unknown) => {
        if (e instanceof BatchError) batchErr = e;
      });

    expect(batchErr).not.toBeNull();
    expect(batchErr!.errors[0]).toBeInstanceOf(Error);
    expect((batchErr!.errors[0] as Error).message).toContain("boom");
    expect(batchErr!.errors[1]).toBeUndefined();
  });

  it("BUG-0255 regression: all inputs are attempted even when one fails (no short-circuit)", async () => {
    const attempted: string[] = [];
    const agent = quickAgent<S>("track", async (state) => {
      attempted.push((state as S).task ?? "");
      if ((state as S).task === "fail-me") throw new Error("fail");
      return { messages: [{ role: "assistant" as const, content: "ok" }], done: true };
    });

    const pool = new AgentPool<S>([agent]);
    await pool
      .batch([
        { task: "task-a" } as Partial<S>,
        { task: "fail-me" } as Partial<S>,
        { task: "task-c" } as Partial<S>,
      ])
      .catch(() => {});

    // All 3 tasks must have been attempted — old Promise.all would short-circuit
    expect(attempted).toContain("task-a");
    expect(attempted).toContain("fail-me");
    expect(attempted).toContain("task-c");
  });
});
