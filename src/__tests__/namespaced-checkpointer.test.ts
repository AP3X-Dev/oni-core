// ============================================================
// NamespacedCheckpointer coverage — threadId prefixing & isolation
// ============================================================

import { describe, it, expect } from "vitest";
import { NamespacedCheckpointer } from "../checkpointers/namespaced.js";
import { MemoryCheckpointer } from "../checkpoint.js";
import type { ONICheckpoint } from "../types.js";

type S = { value: string };

function checkpoint(threadId: string, step: number, value: string): ONICheckpoint<S> {
  return {
    threadId,
    step,
    state: { value },
    nextNodes: [],
    timestamp: step,
  };
}

describe("NamespacedCheckpointer", () => {
  it("returns null when the inner store has nothing", async () => {
    const inner = new MemoryCheckpointer<S>();
    const ns = new NamespacedCheckpointer(inner, "sub");
    await expect(ns.get("t1")).resolves.toBeNull();
  });

  it("round-trips put/get while preserving the caller's threadId", async () => {
    const inner = new MemoryCheckpointer<S>();
    const ns = new NamespacedCheckpointer(inner, "sub");

    await ns.put(checkpoint("t1", 0, "hello"));
    const got = await ns.get("t1");

    expect(got).not.toBeNull();
    expect(got?.threadId).toBe("t1");
    expect(got?.state.value).toBe("hello");
  });

  it("stores under the namespaced key in the inner checkpointer", async () => {
    const inner = new MemoryCheckpointer<S>();
    const ns = new NamespacedCheckpointer(inner, "sub");

    await ns.put(checkpoint("t1", 0, "hello"));

    const rawNamespaced = await inner.get("sub:t1");
    const rawBare = await inner.get("t1");
    expect(rawNamespaced?.state.value).toBe("hello");
    expect(rawBare).toBeNull();
  });

  it("lists checkpoints with the caller's threadId and honors options", async () => {
    const inner = new MemoryCheckpointer<S>();
    const ns = new NamespacedCheckpointer(inner, "sub");

    await ns.put(checkpoint("t1", 0, "a"));
    await ns.put(checkpoint("t1", 1, "b"));
    await ns.put(checkpoint("t1", 2, "c"));

    const all = await ns.list("t1");
    expect(all).toHaveLength(3);
    expect(all.every((c) => c.threadId === "t1")).toBe(true);

    const limited = await ns.list("t1", { limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it("deletes only the namespaced thread", async () => {
    const inner = new MemoryCheckpointer<S>();
    const ns = new NamespacedCheckpointer(inner, "sub");

    await ns.put(checkpoint("t1", 0, "hello"));
    await ns.delete("t1");

    await expect(ns.get("t1")).resolves.toBeNull();
    await expect(inner.get("sub:t1")).resolves.toBeNull();
  });

  it("isolates threads across different namespaces over a shared inner store", async () => {
    const inner = new MemoryCheckpointer<S>();
    const a = new NamespacedCheckpointer(inner, "a");
    const b = new NamespacedCheckpointer(inner, "b");

    await a.put(checkpoint("t1", 0, "from-a"));
    await b.put(checkpoint("t1", 0, "from-b"));

    expect((await a.get("t1"))?.state.value).toBe("from-a");
    expect((await b.get("t1"))?.state.value).toBe("from-b");
  });
});
