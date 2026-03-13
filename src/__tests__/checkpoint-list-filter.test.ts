import { describe, it, expect } from "vitest";
import { MemoryCheckpointer } from "../../src/index.js";

describe("Checkpoint list with filter/before/limit", () => {
  it("limits results", async () => {
    const cp = new MemoryCheckpointer<{ v: number }>();
    for (let i = 0; i < 5; i++) {
      await cp.put({ threadId: "t1", step: i, state: { v: i }, nextNodes: [], timestamp: i * 100, pendingSends: [] });
    }
    const list = await cp.list("t1", { limit: 2 });
    expect(list.length).toBe(2);
  });

  it("filters by before step", async () => {
    const cp = new MemoryCheckpointer<{ v: number }>();
    for (let i = 0; i < 5; i++) {
      await cp.put({ threadId: "t1", step: i, state: { v: i }, nextNodes: [], timestamp: i * 100, pendingSends: [] });
    }
    const list = await cp.list("t1", { before: 3 });
    expect(list.every(c => c.step < 3)).toBe(true);
    expect(list.length).toBe(3);
  });

  it("filters by metadata", async () => {
    const cp = new MemoryCheckpointer<{ v: number }>();
    await cp.put({ threadId: "t1", step: 0, state: { v: 0 }, nextNodes: [], timestamp: 0, pendingSends: [], metadata: { source: "input" } });
    await cp.put({ threadId: "t1", step: 1, state: { v: 1 }, nextNodes: [], timestamp: 100, pendingSends: [], metadata: { source: "loop" } });
    await cp.put({ threadId: "t1", step: 2, state: { v: 2 }, nextNodes: [], timestamp: 200, pendingSends: [], metadata: { source: "loop" } });

    const list = await cp.list("t1", { filter: { source: "loop" } });
    expect(list.length).toBe(2);
    expect(list.every(c => c.metadata?.source === "loop")).toBe(true);
  });

  it("combines before + limit", async () => {
    const cp = new MemoryCheckpointer<{ v: number }>();
    for (let i = 0; i < 10; i++) {
      await cp.put({ threadId: "t1", step: i, state: { v: i }, nextNodes: [], timestamp: i, pendingSends: [] });
    }
    const list = await cp.list("t1", { before: 5, limit: 2 });
    expect(list.length).toBe(2);
    expect(list.every(c => c.step < 5)).toBe(true);
  });
});
