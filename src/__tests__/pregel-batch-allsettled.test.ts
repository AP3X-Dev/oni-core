// Regression test for BUG-0252
// ONIPregelRunner.batch() previously used Promise.all, causing one rejected invocation
// to cancel the entire batch and discard results from all other invocations, which
// continued running as orphaned promises with no cleanup.
// Fix: batch() now uses Promise.allSettled internally and throws BatchError (with
// .results and .errors) when any input fails, preserving results from successful
// invocations.

import { describe, it, expect, vi } from "vitest";
import { StateGraph } from "../graph.js";
import { START, END, lastValue, appendList } from "../types.js";
import { BatchError } from "../swarm/pool.js";

type S = { value: number; log: string[] };

function makeGraph(nodeFn: (s: S) => Partial<S>) {
  const g = new StateGraph<S>({
    channels: {
      value: lastValue(() => 0),
      log:   appendList(() => [] as string[]),
    },
  });
  g.addNode("work", nodeFn);
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return g.compile();
}

describe("BUG-0252: ONIPregelRunner.batch() uses allSettled", () => {
  it("BUG-0252: returns S[] when all inputs succeed", async () => {
    const app = makeGraph((s) => ({ value: s.value * 2 }));

    const results = await app.batch([
      { value: 1 },
      { value: 2 },
      { value: 3 },
    ]);

    expect(results).toHaveLength(3);
    expect(results[0].value).toBe(2);
    expect(results[1].value).toBe(4);
    expect(results[2].value).toBe(6);
  });

  it("BUG-0252: throws BatchError when any input fails", async () => {
    let call = 0;
    const app = makeGraph((s) => {
      const n = call++;
      if (n === 1) throw new Error("intentional-fail");
      return { value: s.value };
    });

    const err = await app
      .batch([{ value: 10 }, { value: 20 }, { value: 30 }])
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BatchError);
  });

  it("BUG-0252 regression: all inputs attempted even when one fails (no short-circuit)", async () => {
    const attempted: number[] = [];
    let call = 0;
    const app = makeGraph((s) => {
      const n = call++;
      attempted.push(s.value);
      if (n === 0) throw new Error("first-fails");
      return { value: s.value };
    });

    await app
      .batch([{ value: 10 }, { value: 20 }, { value: 30 }])
      .catch(() => {});

    // Old Promise.all would short-circuit — all 3 must be attempted
    expect(attempted).toContain(10);
    expect(attempted).toContain(20);
    expect(attempted).toContain(30);
  });

  it("BUG-0252: BatchError.results preserves successful outputs alongside undefined for failures", async () => {
    let call = 0;
    const app = makeGraph((s) => {
      const n = call++;
      if (n === 1) throw new Error("fail-slot-1");
      return { value: s.value * 10 };
    });

    let batchErr: BatchError<S> | null = null;

    await app
      .batch([{ value: 1 }, { value: 2 }, { value: 3 }])
      .catch((e: unknown) => {
        if (e instanceof BatchError) batchErr = e as BatchError<S>;
      });

    expect(batchErr).not.toBeNull();
    expect(batchErr!.results).toHaveLength(3);
    // Slot 1 failed — undefined
    expect(batchErr!.results[1]).toBeUndefined();
    // Slots 0 and 2 succeeded
    expect(batchErr!.results[0]).toBeDefined();
    expect((batchErr!.results[0] as S).value).toBe(10);
    expect(batchErr!.results[2]).toBeDefined();
    expect((batchErr!.results[2] as S).value).toBe(30);
  });

  it("BUG-0252: BatchError.errors contains rejection reasons for failed slots", async () => {
    let call = 0;
    const app = makeGraph((s) => {
      const n = call++;
      if (n === 2) throw new Error("slot-2-boom");
      return { value: s.value };
    });

    let batchErr: BatchError<S> | null = null;

    await app
      .batch([{ value: 1 }, { value: 2 }, { value: 3 }])
      .catch((e: unknown) => {
        if (e instanceof BatchError) batchErr = e as BatchError<S>;
      });

    expect(batchErr).not.toBeNull();
    expect(batchErr!.errors[2]).toBeInstanceOf(Error);
    expect((batchErr!.errors[2] as Error).message).toContain("slot-2-boom");
    expect(batchErr!.errors[0]).toBeUndefined();
    expect(batchErr!.errors[1]).toBeUndefined();
  });

  it("BUG-0252: BatchError message includes failure count", async () => {
    let call = 0;
    const app = makeGraph(() => {
      if (call++ < 2) throw new Error("fail");
      return { value: 99 };
    });

    const err = await app
      .batch([{ value: 1 }, { value: 2 }, { value: 3 }])
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BatchError);
    expect((err as BatchError<S>).message).toMatch(/2 of 3/);
  });
});
