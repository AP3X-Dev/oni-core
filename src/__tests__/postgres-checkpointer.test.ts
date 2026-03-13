import { describe, it, expect, vi } from "vitest";

// Mock the pg module before importing
vi.mock("pg", () => {
  const rows = new Map<string, any>();

  const mockPool = {
    query: vi.fn(async (sql: string, params?: any[]) => {
      if (sql.includes("CREATE TABLE")) return { rows: [] };
      if (sql.includes("CREATE INDEX")) return { rows: [] };

      if (sql.includes("INSERT") || sql.includes("UPDATE")) {
        const key = `${params![0]}::${params![1]}`;
        rows.set(key, {
          thread_id: params![0],
          step: params![1],
          agent_id: params![2],
          state: params![3],
          next_nodes: params![4],
          pending_sends: params![5],
          metadata: params![6],
          pending_writes: params![7],
          timestamp: params![8],
        });
        return { rows: [] };
      }

      if (sql.includes("DELETE")) {
        const threadId = params![0];
        for (const [k] of rows) {
          if (k.startsWith(`${threadId}::`)) rows.delete(k);
        }
        return { rows: [] };
      }

      if (sql.includes("ORDER BY step DESC LIMIT 1")) {
        const threadId = params![0];
        const matching = [...rows.values()]
          .filter(r => r.thread_id === threadId)
          .sort((a, b) => b.step - a.step);
        return { rows: matching.slice(0, 1) };
      }

      if (sql.includes("ORDER BY step ASC")) {
        const threadId = params![0];
        const matching = [...rows.values()]
          .filter(r => r.thread_id === threadId)
          .sort((a, b) => a.step - b.step);
        return { rows: matching };
      }

      return { rows: [] };
    }),
    end: vi.fn(),
  };

  // Use a regular function so it can be called with `new`
  function MockPool() { return mockPool; }

  return {
    default: { Pool: MockPool },
    Pool: MockPool,
  };
});

import { PostgresCheckpointer } from "../checkpointers/postgres.js";

describe("PostgresCheckpointer", () => {
  it("creates instance and saves/retrieves checkpoint", async () => {
    const cp = await PostgresCheckpointer.create<{ value: string }>("mock://");

    await cp.put({
      threadId: "t1",
      step: 0,
      state: { value: "hello" },
      nextNodes: ["a"],
      timestamp: 1000,
      pendingSends: [],
    });

    const got = await cp.get("t1");
    expect(got).not.toBeNull();
    expect(got!.threadId).toBe("t1");
    expect(got!.state).toEqual({ value: "hello" });
  });

  it("lists checkpoints in order", async () => {
    const cp = await PostgresCheckpointer.create<{ v: number }>("mock://");

    await cp.put({ threadId: "t2", step: 0, state: { v: 0 }, nextNodes: [], timestamp: 1, pendingSends: [] });
    await cp.put({ threadId: "t2", step: 1, state: { v: 1 }, nextNodes: [], timestamp: 2, pendingSends: [] });

    const list = await cp.list("t2");
    expect(list.length).toBe(2);
    expect(list[0].step).toBe(0);
    expect(list[1].step).toBe(1);
  });

  it("deletes all checkpoints for thread", async () => {
    const cp = await PostgresCheckpointer.create<{ v: number }>("mock://");

    await cp.put({ threadId: "t3", step: 0, state: { v: 0 }, nextNodes: [], timestamp: 1, pendingSends: [] });
    await cp.delete("t3");

    const got = await cp.get("t3");
    expect(got).toBeNull();
  });
});
