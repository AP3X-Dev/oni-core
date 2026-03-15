import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ONICheckpoint } from "../types.js";

// ── In-memory Redis mock ─────────────────────────────────────────────────────

const store = new Map<string, string>();
const sortedSets = new Map<string, Map<string, number>>(); // key → member → score

function mockZrange(key: string, start: number | string, stop: number | string, opts?: { REV?: boolean }): string[] {
  const set = sortedSets.get(key);
  if (!set) return [];
  const entries = [...set.entries()].sort((a, b) => a[1] - b[1]); // asc by score
  const members = entries.map(e => e[0]);
  const len = members.length;

  if (opts?.REV) {
    const reversed = [...members].reverse();
    const s = typeof start === "number" ? start : 0;
    const e = typeof stop === "number" ? stop : len - 1;
    return reversed.slice(s, e === -1 ? undefined : e + 1);
  }

  const s = typeof start === "number" ? start : 0;
  const e = typeof stop === "number" ? stop : len - 1;
  return members.slice(s, e === -1 ? undefined : e + 1);
}

const mockClient = {
  set: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
  get: vi.fn(async (key: string): Promise<string | null> => store.get(key) ?? null),
  del: vi.fn(async (...keys: string[]) => { keys.forEach(k => { store.delete(k); sortedSets.delete(k); }); }),
  zadd: vi.fn(async (key: string, score: number, member: string) => {
    if (!sortedSets.has(key)) sortedSets.set(key, new Map());
    sortedSets.get(key)!.set(member, score);
  }),
  zrange: vi.fn(async (key: string, start: number | string, stop: number | string, opts?: { REV?: boolean }): Promise<string[]> => {
    return mockZrange(key, start, stop, opts);
  }),
  keys: vi.fn(async (pattern: string): Promise<string[]> => {
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
    return [...store.keys()].filter(k => regex.test(k));
  }),
  disconnect: vi.fn(async () => {}),
};

vi.mock("ioredis", () => {
  function MockRedis(_url: string) {
    return mockClient;
  }
  return { default: MockRedis };
});

// Import AFTER mock is registered
import { RedisCheckpointer } from "../checkpointers/redis.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCheckpoint<S>(threadId: string, step: number, state: S): ONICheckpoint<S> {
  return { threadId, step, state, nextNodes: [], timestamp: Date.now(), pendingSends: [] };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("RedisCheckpointer (mocked ioredis)", () => {
  let cp: RedisCheckpointer<{ value: string }>;

  beforeEach(async () => {
    store.clear();
    sortedSets.clear();
    vi.clearAllMocks();
    cp = await RedisCheckpointer.create<{ value: string }>({ url: "redis://localhost:6379" });
  });

  it("is exported correctly and has a create() factory", () => {
    expect(RedisCheckpointer).toBeDefined();
    expect(typeof RedisCheckpointer.create).toBe("function");
  });

  it("put() stores a checkpoint and get() retrieves the latest", async () => {
    await cp.put(makeCheckpoint("thread-1", 0, { value: "hello" }));

    const got = await cp.get("thread-1");
    expect(got).not.toBeNull();
    expect(got!.threadId).toBe("thread-1");
    expect(got!.step).toBe(0);
    expect(got!.state).toEqual({ value: "hello" });
  });

  it("get() returns null when no checkpoint exists", async () => {
    const got = await cp.get("nonexistent");
    expect(got).toBeNull();
  });

  it("get() returns the latest (highest step) checkpoint", async () => {
    await cp.put(makeCheckpoint("thread-2", 0, { value: "step0" }));
    await cp.put(makeCheckpoint("thread-2", 1, { value: "step1" }));
    await cp.put(makeCheckpoint("thread-2", 2, { value: "step2" }));

    const got = await cp.get("thread-2");
    expect(got!.step).toBe(2);
    expect(got!.state).toEqual({ value: "step2" });
  });

  it("list() returns checkpoints in ascending step order", async () => {
    await cp.put(makeCheckpoint("thread-3", 0, { value: "a" }));
    await cp.put(makeCheckpoint("thread-3", 1, { value: "b" }));
    await cp.put(makeCheckpoint("thread-3", 2, { value: "c" }));

    const items = await cp.list("thread-3");
    expect(items).toHaveLength(3);
    expect(items[0].step).toBe(0);
    expect(items[1].step).toBe(1);
    expect(items[2].step).toBe(2);
  });

  it("list() with opts.before excludes steps >= before value", async () => {
    await cp.put(makeCheckpoint("thread-4", 0, { value: "a" }));
    await cp.put(makeCheckpoint("thread-4", 1, { value: "b" }));
    await cp.put(makeCheckpoint("thread-4", 2, { value: "c" }));

    const items = await cp.list("thread-4", { before: 2 });
    expect(items).toHaveLength(2);
    expect(items.every(i => i.step < 2)).toBe(true);
  });

  it("list() with opts.limit caps the result count", async () => {
    await cp.put(makeCheckpoint("thread-5", 0, { value: "a" }));
    await cp.put(makeCheckpoint("thread-5", 1, { value: "b" }));
    await cp.put(makeCheckpoint("thread-5", 2, { value: "c" }));

    const items = await cp.list("thread-5", { limit: 2 });
    expect(items).toHaveLength(2);
  });

  it("list() with opts.filter matches by metadata", async () => {
    const c1 = { ...makeCheckpoint("thread-6", 0, { value: "a" }), metadata: { tag: "foo" } };
    const c2 = { ...makeCheckpoint("thread-6", 1, { value: "b" }), metadata: { tag: "bar" } };
    await cp.put(c1);
    await cp.put(c2);

    const items = await cp.list("thread-6", { filter: { tag: "foo" } });
    expect(items).toHaveLength(1);
    expect(items[0].step).toBe(0);
  });

  it("delete() removes all checkpoints for a thread", async () => {
    await cp.put(makeCheckpoint("thread-7", 0, { value: "a" }));
    await cp.put(makeCheckpoint("thread-7", 1, { value: "b" }));

    await cp.delete("thread-7");

    expect(await cp.get("thread-7")).toBeNull();
    expect(await cp.list("thread-7")).toHaveLength(0);
  });

  it("delete() on non-existent thread does not throw", async () => {
    await expect(cp.delete("thread-unknown")).resolves.toBeUndefined();
  });

  it("close() calls disconnect on the client", async () => {
    await cp.close();
    expect(mockClient.disconnect).toHaveBeenCalled();
  });

  it("isolates checkpoints between different threadIds", async () => {
    await cp.put(makeCheckpoint("thread-A", 0, { value: "A" }));
    await cp.put(makeCheckpoint("thread-B", 0, { value: "B" }));

    const gotA = await cp.get("thread-A");
    const gotB = await cp.get("thread-B");
    expect(gotA!.state).toEqual({ value: "A" });
    expect(gotB!.state).toEqual({ value: "B" });
  });
});

// ── Integration tests (only when REDIS_URL env var is set) ───────────────────

const REDIS_URL = process.env.REDIS_URL;

describe.skipIf(!REDIS_URL)("RedisCheckpointer integration", () => {
  let rcp: RedisCheckpointer<{ count: number }>;

  it("creates via real Redis connection", async () => {
    rcp = await RedisCheckpointer.create<{ count: number }>({ url: REDIS_URL!, prefix: "test-int" });
    expect(rcp).toBeDefined();
  });

  it("put, get, list, delete round-trip", async () => {
    rcp = await RedisCheckpointer.create<{ count: number }>({ url: REDIS_URL!, prefix: "test-int-rt" });
    const threadId = `integration-${Date.now()}`;

    await rcp.put(makeCheckpoint(threadId, 0, { count: 0 }));
    await rcp.put(makeCheckpoint(threadId, 1, { count: 1 }));

    const latest = await rcp.get(threadId);
    expect(latest!.step).toBe(1);
    expect(latest!.state.count).toBe(1);

    const all = await rcp.list(threadId);
    expect(all).toHaveLength(2);

    await rcp.delete(threadId);
    expect(await rcp.get(threadId)).toBeNull();

    await rcp.close();
  });
});
