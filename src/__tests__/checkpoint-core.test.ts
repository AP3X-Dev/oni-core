import { describe, it, expect } from "vitest";
import { MemoryCheckpointer, NoopCheckpointer, PersistentCheckpointer } from "../checkpoint.js";
import type { ONICheckpoint, CheckpointListOptions } from "../types.js";

/* ------------------------------------------------------------------ */
/*  Helper                                                            */
/* ------------------------------------------------------------------ */

function makeCheckpoint<S>(threadId: string, step: number, state: S, extra?: Partial<ONICheckpoint<S>>): ONICheckpoint<S> {
  return {
    threadId,
    step,
    state,
    nextNodes: extra?.nextNodes ?? [],
    pendingSends: extra?.pendingSends ?? [],
    timestamp: extra?.timestamp ?? step * 100,
    metadata: extra?.metadata,
    pendingWrites: extra?.pendingWrites,
  };
}

/* ------------------------------------------------------------------ */
/*  MemoryCheckpointer                                                */
/* ------------------------------------------------------------------ */

describe("MemoryCheckpointer", () => {

  // ── get() ──────────────────────────────────────────────────────

  it("get() returns latest checkpoint for a thread", async () => {
    const cp = new MemoryCheckpointer<{ v: number }>();
    await cp.put(makeCheckpoint("t1", 0, { v: 0 }));
    await cp.put(makeCheckpoint("t1", 1, { v: 1 }));
    await cp.put(makeCheckpoint("t1", 2, { v: 2 }));

    const latest = await cp.get("t1");
    expect(latest).not.toBeNull();
    expect(latest!.step).toBe(2);
    expect(latest!.state).toEqual({ v: 2 });
  });

  it("get() returns null for unknown thread", async () => {
    const cp = new MemoryCheckpointer<{ v: number }>();
    expect(await cp.get("nonexistent")).toBeNull();
  });

  // ── put() idempotent ──────────────────────────────────────────

  it("put() overwrites checkpoint at same step (idempotent)", async () => {
    const cp = new MemoryCheckpointer<{ v: number }>();
    await cp.put(makeCheckpoint("t1", 0, { v: 0 }));
    await cp.put(makeCheckpoint("t1", 1, { v: 10 }));

    // Overwrite step 1 with different state
    await cp.put(makeCheckpoint("t1", 1, { v: 99 }));

    const all = await cp.list("t1");
    expect(all.length).toBe(2); // still 2, not 3
    const step1 = all.find(c => c.step === 1);
    expect(step1!.state).toEqual({ v: 99 });
  });

  // ── delete() ──────────────────────────────────────────────────

  it("delete() removes all checkpoints for a thread", async () => {
    const cp = new MemoryCheckpointer<{ v: number }>();
    await cp.put(makeCheckpoint("t1", 0, { v: 0 }));
    await cp.put(makeCheckpoint("t1", 1, { v: 1 }));
    await cp.put(makeCheckpoint("t2", 0, { v: 100 }));

    await cp.delete("t1");

    expect(await cp.get("t1")).toBeNull();
    expect(await cp.get("t2")).not.toBeNull(); // t2 unaffected
  });

  // ── getAt() ───────────────────────────────────────────────────

  it("getAt() retrieves checkpoint at specific step", async () => {
    const cp = new MemoryCheckpointer<{ v: number }>();
    await cp.put(makeCheckpoint("t1", 0, { v: 0 }));
    await cp.put(makeCheckpoint("t1", 1, { v: 1 }));
    await cp.put(makeCheckpoint("t1", 2, { v: 2 }));

    const at1 = await cp.getAt("t1", 1);
    expect(at1).not.toBeNull();
    expect(at1!.step).toBe(1);
    expect(at1!.state).toEqual({ v: 1 });
  });

  it("getAt() returns null for nonexistent step", async () => {
    const cp = new MemoryCheckpointer<{ v: number }>();
    await cp.put(makeCheckpoint("t1", 0, { v: 0 }));

    expect(await cp.getAt("t1", 99)).toBeNull();
  });

  it("getAt() returns null for unknown thread", async () => {
    const cp = new MemoryCheckpointer<{ v: number }>();
    expect(await cp.getAt("nonexistent", 0)).toBeNull();
  });

  // ── fork() ────────────────────────────────────────────────────

  it("fork() clones history up to step under new threadId", async () => {
    const cp = new MemoryCheckpointer<{ v: number }>();
    await cp.put(makeCheckpoint("src", 0, { v: 0 }));
    await cp.put(makeCheckpoint("src", 1, { v: 1 }));
    await cp.put(makeCheckpoint("src", 2, { v: 2 }));
    await cp.put(makeCheckpoint("src", 3, { v: 3 }));

    const ok = await cp.fork("src", 2, "forked");
    expect(ok).toBe(true);

    // Forked thread should have steps 0, 1, 2 (not 3)
    const forkedHistory = await cp.list("forked");
    expect(forkedHistory.length).toBe(3);
    expect(forkedHistory.map(c => c.step)).toEqual([0, 1, 2]);

    // All forked checkpoints have the new threadId
    expect(forkedHistory.every(c => c.threadId === "forked")).toBe(true);

    // Source thread is unmodified
    const sourceHistory = await cp.list("src");
    expect(sourceHistory.length).toBe(4);
  });

  it("fork() returns false when source has no matching steps", async () => {
    const cp = new MemoryCheckpointer<{ v: number }>();
    expect(await cp.fork("nonexistent", 0, "dest")).toBe(false);
  });

  it("fork() returns false when all steps are above target", async () => {
    const cp = new MemoryCheckpointer<{ v: number }>();
    await cp.put(makeCheckpoint("src", 5, { v: 5 }));
    await cp.put(makeCheckpoint("src", 6, { v: 6 }));

    expect(await cp.fork("src", 2, "dest")).toBe(false);
  });

  it("fork() creates independent copy (mutations don't cross)", async () => {
    const cp = new MemoryCheckpointer<{ v: number }>();
    await cp.put(makeCheckpoint("src", 0, { v: 0 }));
    await cp.put(makeCheckpoint("src", 1, { v: 1 }));

    await cp.fork("src", 1, "branch");

    // Add to source after fork
    await cp.put(makeCheckpoint("src", 2, { v: 2 }));

    // Branch should not see step 2
    const branchHistory = await cp.list("branch");
    expect(branchHistory.length).toBe(2);
    expect(branchHistory.map(c => c.step)).toEqual([0, 1]);
  });

  // ── clear() ───────────────────────────────────────────────────

  it("clear() removes all threads", async () => {
    const cp = new MemoryCheckpointer<{ v: number }>();
    await cp.put(makeCheckpoint("t1", 0, { v: 0 }));
    await cp.put(makeCheckpoint("t2", 0, { v: 100 }));
    await cp.put(makeCheckpoint("t3", 0, { v: 200 }));

    cp.clear();

    expect(await cp.get("t1")).toBeNull();
    expect(await cp.get("t2")).toBeNull();
    expect(await cp.get("t3")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  NoopCheckpointer                                                  */
/* ------------------------------------------------------------------ */

describe("NoopCheckpointer", () => {
  it("get() always returns null", async () => {
    const cp = new NoopCheckpointer<{ v: number }>();
    expect(await cp.get("any")).toBeNull();
  });

  it("put() is a no-op (does not throw)", async () => {
    const cp = new NoopCheckpointer<{ v: number }>();
    await expect(cp.put(makeCheckpoint("t1", 0, { v: 0 }))).resolves.toBeUndefined();
  });

  it("list() always returns empty array", async () => {
    const cp = new NoopCheckpointer<{ v: number }>();
    expect(await cp.list("any")).toEqual([]);
  });

  it("delete() is a no-op (does not throw)", async () => {
    const cp = new NoopCheckpointer<{ v: number }>();
    await expect(cp.delete("any")).resolves.toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  PersistentCheckpointer (abstract base)                            */
/* ------------------------------------------------------------------ */

/** Concrete subclass for testing base class getAt/fork defaults */
class TestPersistentCheckpointer<S> extends PersistentCheckpointer<S> {
  private store = new Map<string, ONICheckpoint<S>[]>();

  async get(threadId: string): Promise<ONICheckpoint<S> | null> {
    const h = this.store.get(threadId);
    return h?.length ? h[h.length - 1]! : null;
  }

  async put(cp: ONICheckpoint<S>): Promise<void> {
    const existing = this.store.get(cp.threadId) ?? [];
    const idx = existing.findIndex(c => c.step === cp.step);
    if (idx >= 0) existing[idx] = { ...cp };
    else existing.push({ ...cp });
    this.store.set(cp.threadId, existing);
  }

  async list(threadId: string, opts?: CheckpointListOptions): Promise<ONICheckpoint<S>[]> {
    let items = [...(this.store.get(threadId) ?? [])];
    if (opts?.before !== undefined) items = items.filter(c => c.step < opts.before!);
    if (opts?.limit !== undefined) items = items.slice(0, opts.limit);
    return items;
  }

  async delete(threadId: string): Promise<void> {
    this.store.delete(threadId);
  }
}

describe("PersistentCheckpointer (base class defaults)", () => {
  it("getAt() finds checkpoint at specific step via list()", async () => {
    const cp = new TestPersistentCheckpointer<{ v: number }>();
    await cp.put(makeCheckpoint("t1", 0, { v: 0 }));
    await cp.put(makeCheckpoint("t1", 1, { v: 1 }));
    await cp.put(makeCheckpoint("t1", 2, { v: 2 }));

    const at1 = await cp.getAt("t1", 1);
    expect(at1).not.toBeNull();
    expect(at1!.step).toBe(1);
    expect(at1!.state).toEqual({ v: 1 });
  });

  it("getAt() returns null for missing step", async () => {
    const cp = new TestPersistentCheckpointer<{ v: number }>();
    await cp.put(makeCheckpoint("t1", 0, { v: 0 }));

    expect(await cp.getAt("t1", 99)).toBeNull();
  });

  it("fork() clones history up to step via list + put", async () => {
    const cp = new TestPersistentCheckpointer<{ v: number }>();
    await cp.put(makeCheckpoint("src", 0, { v: 0 }));
    await cp.put(makeCheckpoint("src", 1, { v: 1 }));
    await cp.put(makeCheckpoint("src", 2, { v: 2 }));

    const ok = await cp.fork("src", 1, "dest");
    expect(ok).toBe(true);

    const destHistory = await cp.list("dest");
    expect(destHistory.length).toBe(2);
    expect(destHistory.every(c => c.threadId === "dest")).toBe(true);
    expect(destHistory.map(c => c.step)).toEqual([0, 1]);
  });

  it("fork() returns false for empty source", async () => {
    const cp = new TestPersistentCheckpointer<{ v: number }>();
    expect(await cp.fork("nonexistent", 0, "dest")).toBe(false);
  });
});
