import { describe, it, expect, vi, beforeEach } from "vitest";
import { CheckpointCorruptError } from "../errors.js";

/* ------------------------------------------------------------------ */
/*  Fake Database for testing SqliteCheckpointer without better-sqlite3*/
/* ------------------------------------------------------------------ */

interface FakeStatement {
  run: (...args: unknown[]) => void;
  get: (...args: unknown[]) => unknown;
  all: (...args: unknown[]) => unknown[];
}

class FakeDatabase {
  private rows: Record<string, unknown>[] = [];

  prepare(_sql: string): FakeStatement {
    const self = this;
    return {
      run: () => {},
      get: () => self.rows[0] ?? undefined,
      all: () => self.rows,
    };
  }

  exec(_sql: string): void {}
  close(): void {}

  // Test helper: set what get() returns
  setRow(row: Record<string, unknown>): void {
    this.rows = [row];
  }

  setRows(rows: Record<string, unknown>[]): void {
    this.rows = rows;
  }
}

/* ------------------------------------------------------------------ */
/*  Import SqliteCheckpointer by mocking the dynamic import           */
/* ------------------------------------------------------------------ */

// We can't use SqliteCheckpointer.create() because it dynamically imports
// better-sqlite3. Instead, we use the class's private constructor via a trick:
// We mock the module import so create() succeeds with our fake DB.

let fakeDb: FakeDatabase;

vi.mock("better-sqlite3", () => {
  return {
    default: class {
      prepare = (sql: string) => fakeDb.prepare(sql);
      exec = (sql: string) => fakeDb.exec(sql);
      close = () => fakeDb.close();
    },
  };
});

// Must import AFTER the mock is set up
const { SqliteCheckpointer } = await import("../checkpointers/sqlite.js");

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe("SqliteCheckpointer", () => {
  let checkpointer: InstanceType<typeof SqliteCheckpointer>;

  beforeEach(async () => {
    fakeDb = new FakeDatabase();
    checkpointer = await SqliteCheckpointer.create(":memory:");
  });

  it("get() returns null when no row exists", async () => {
    const result = await checkpointer.get("thread-1");
    expect(result).toBeNull();
  });

  it("get() deserializes valid checkpoint data", async () => {
    fakeDb.setRow({
      thread_id: "thread-1",
      step: 3,
      agent_id: "agent-a",
      state: JSON.stringify({ count: 42 }),
      next_nodes: JSON.stringify(["nodeA", "nodeB"]),
      pending_sends: JSON.stringify([]),
      metadata: JSON.stringify({ source: "test" }),
      pending_writes: null,
      timestamp: 1234567890,
    });

    const cp = await checkpointer.get("thread-1");
    expect(cp).not.toBeNull();
    expect(cp!.threadId).toBe("thread-1");
    expect(cp!.step).toBe(3);
    expect(cp!.agentId).toBe("agent-a");
    expect(cp!.state).toEqual({ count: 42 });
    expect(cp!.nextNodes).toEqual(["nodeA", "nodeB"]);
    expect(cp!.pendingSends).toEqual([]);
    expect(cp!.metadata).toEqual({ source: "test" });
    expect(cp!.pendingWrites).toBeUndefined();
    expect(cp!.timestamp).toBe(1234567890);
  });

  it("get() throws CheckpointCorruptError on corrupt state JSON", async () => {
    fakeDb.setRow({
      thread_id: "thread-corrupt",
      step: 1,
      agent_id: null,
      state: "not valid json{{{",
      next_nodes: JSON.stringify([]),
      pending_sends: JSON.stringify([]),
      metadata: null,
      pending_writes: null,
      timestamp: 1000,
    });

    await expect(checkpointer.get("thread-corrupt")).rejects.toThrow(CheckpointCorruptError);
    await expect(checkpointer.get("thread-corrupt")).rejects.toThrow(/thread-corrupt/);
  });

  it("get() throws CheckpointCorruptError on corrupt next_nodes JSON", async () => {
    fakeDb.setRow({
      thread_id: "thread-bad-nodes",
      step: 1,
      agent_id: null,
      state: JSON.stringify({}),
      next_nodes: "[broken",
      pending_sends: JSON.stringify([]),
      metadata: null,
      pending_writes: null,
      timestamp: 1000,
    });

    await expect(checkpointer.get("thread-bad-nodes")).rejects.toThrow(CheckpointCorruptError);
  });

  it("get() throws CheckpointCorruptError on corrupt pending_sends JSON", async () => {
    fakeDb.setRow({
      thread_id: "thread-bad-sends",
      step: 1,
      agent_id: null,
      state: JSON.stringify({}),
      next_nodes: JSON.stringify([]),
      pending_sends: "{{invalid}}",
      metadata: null,
      pending_writes: null,
      timestamp: 1000,
    });

    await expect(checkpointer.get("thread-bad-sends")).rejects.toThrow(CheckpointCorruptError);
  });

  it("get() throws CheckpointCorruptError on corrupt metadata JSON", async () => {
    fakeDb.setRow({
      thread_id: "thread-bad-meta",
      step: 1,
      agent_id: null,
      state: JSON.stringify({}),
      next_nodes: JSON.stringify([]),
      pending_sends: JSON.stringify([]),
      metadata: "not-json",
      pending_writes: null,
      timestamp: 1000,
    });

    await expect(checkpointer.get("thread-bad-meta")).rejects.toThrow(CheckpointCorruptError);
  });

  it("get() throws CheckpointCorruptError on corrupt pending_writes JSON", async () => {
    fakeDb.setRow({
      thread_id: "thread-bad-writes",
      step: 1,
      agent_id: null,
      state: JSON.stringify({}),
      next_nodes: JSON.stringify([]),
      pending_sends: JSON.stringify([]),
      metadata: null,
      pending_writes: "}{bad",
      timestamp: 1000,
    });

    await expect(checkpointer.get("thread-bad-writes")).rejects.toThrow(CheckpointCorruptError);
  });

  it("list() throws CheckpointCorruptError when any row is corrupt", async () => {
    fakeDb.setRows([
      {
        thread_id: "thread-list",
        step: 1,
        agent_id: null,
        state: "corrupt!!!",
        next_nodes: JSON.stringify([]),
        pending_sends: JSON.stringify([]),
        metadata: null,
        pending_writes: null,
        timestamp: 1000,
      },
    ]);

    await expect(checkpointer.list("thread-list")).rejects.toThrow(CheckpointCorruptError);
  });

  it("getAt() throws CheckpointCorruptError on corrupt row", async () => {
    fakeDb.setRow({
      thread_id: "thread-at",
      step: 5,
      agent_id: null,
      state: "bad json",
      next_nodes: JSON.stringify([]),
      pending_sends: JSON.stringify([]),
      metadata: null,
      pending_writes: null,
      timestamp: 1000,
    });

    await expect(checkpointer.getAt("thread-at", 5)).rejects.toThrow(CheckpointCorruptError);
  });

  it("CheckpointCorruptError includes thread ID and detail", async () => {
    fakeDb.setRow({
      thread_id: "thread-detail",
      step: 1,
      agent_id: null,
      state: "<<<corrupt>>>",
      next_nodes: JSON.stringify([]),
      pending_sends: JSON.stringify([]),
      metadata: null,
      pending_writes: null,
      timestamp: 1000,
    });

    try {
      await checkpointer.get("thread-detail");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CheckpointCorruptError);
      const e = err as InstanceType<typeof CheckpointCorruptError>;
      expect(e.code).toBe("ONI_CHECKPOINT_CORRUPT");
      expect(e.category).toBe("CHECKPOINT");
      expect(e.context["threadId"]).toBe("thread-detail");
      expect(typeof e.context["detail"]).toBe("string");
    }
  });
});
