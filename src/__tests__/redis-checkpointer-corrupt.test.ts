/**
 * Regression test for BUG-0278:
 * RedisCheckpointer.deserialize() must throw CheckpointCorruptError with descriptive
 * messages when stored data is corrupted or missing required fields, instead of
 * propagating raw TypeError or returning silently wrong data.
 *
 * Before the fix, get() called `JSON.parse(raw) as ONICheckpoint<S>` without any
 * field validation, so corrupted Redis entries produced partial checkpoint objects
 * that only blew up downstream — far from the deserialization site.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CheckpointCorruptError } from "../errors.js";
import type { ONICheckpoint } from "../types.js";

// ── Minimal mock Redis client ─────────────────────────────────────────────────

const store = new Map<string, string>();
const sortedSets = new Map<string, Map<string, number>>();

const mockClient = {
  set: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
  get: vi.fn(async (key: string): Promise<string | null> => store.get(key) ?? null),
  del: vi.fn(async (...keys: string[]) => {
    keys.forEach(k => { store.delete(k); sortedSets.delete(k); });
  }),
  zadd: vi.fn(async (key: string, score: number, member: string) => {
    if (!sortedSets.has(key)) sortedSets.set(key, new Map());
    sortedSets.get(key)!.set(member, score);
  }),
  zrange: vi.fn(async (key: string, start: number, stop: number): Promise<string[]> => {
    const set = sortedSets.get(key);
    if (!set) return [];
    const entries = [...set.entries()].sort((a, b) => a[1] - b[1]);
    const members = entries.map(e => e[0]);
    const len = members.length;
    const s = start;
    const e = stop === -1 ? len : stop + 1;
    return members.slice(s, e);
  }),
  keys: vi.fn(async (_pattern: string): Promise<string[]> => [...store.keys()]),
  eval: vi.fn(async (_script: string, _numkeys: number, dataKey: string, _idxKey: string, value: string, step: number) => {
    store.set(dataKey, value);
    const idxK = _idxKey;
    if (!sortedSets.has(idxK)) sortedSets.set(idxK, new Map());
    sortedSets.get(idxK)!.set(String(step), Number(step));
    return "OK";
  }),
  disconnect: vi.fn(async () => {}),
};

vi.mock("ioredis", () => {
  function MockRedis(_url: string) { return mockClient; }
  return { default: MockRedis };
});

import { RedisCheckpointer } from "../checkpointers/redis.js";

// ── Helper: directly inject raw corrupt data into the mock store ──────────────

// RedisCheckpointer uses prefix="default" by default.
// dataKey = `oni:cp:default:${threadId}:${step}`
// idxKey  = `oni:cp:idx:default:${threadId}`
function injectRaw(threadId: string, step: number, raw: string): void {
  const dataKey = `oni:cp:default:${threadId}:${step}`;
  const idxKey  = `oni:cp:idx:default:${threadId}`;
  store.set(dataKey, raw);
  if (!sortedSets.has(idxKey)) sortedSets.set(idxKey, new Map());
  sortedSets.get(idxKey)!.set(String(step), step);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("BUG-0278: RedisCheckpointer.deserialize() validates corrupt checkpoint data", () => {
  let cp: RedisCheckpointer<{ value: string }>;

  beforeEach(async () => {
    store.clear();
    sortedSets.clear();
    vi.clearAllMocks();
    cp = await RedisCheckpointer.create<{ value: string }>({ url: "redis://localhost:6379" });
  });

  it("BUG-0278: round-trips a valid checkpoint without throwing", async () => {
    const checkpoint: ONICheckpoint<{ value: string }> = {
      threadId: "t1",
      step: 0,
      state: { value: "ok" },
      nextNodes: [],
      timestamp: Date.now(),
      pendingSends: [],
    };
    await cp.put(checkpoint);
    const got = await cp.get("t1");
    expect(got).not.toBeNull();
    expect(got!.threadId).toBe("t1");
    expect(got!.state).toEqual({ value: "ok" });
  });

  it("BUG-0278: throws CheckpointCorruptError for malformed JSON", async () => {
    injectRaw("corrupt-json", 0, "not-valid-json{{{");
    await expect(cp.get("corrupt-json")).rejects.toThrow(CheckpointCorruptError);
    await expect(cp.get("corrupt-json")).rejects.toThrow(/truncated|corrupted|parse/i);
  });

  it("BUG-0278: throws CheckpointCorruptError when stored value is null literal", async () => {
    injectRaw("null-cp", 0, "null");
    await expect(cp.get("null-cp")).rejects.toThrow(CheckpointCorruptError);
  });

  it("BUG-0278: throws CheckpointCorruptError for non-object stored value", async () => {
    injectRaw("scalar-cp", 0, '"just a string"');
    await expect(cp.get("scalar-cp")).rejects.toThrow(CheckpointCorruptError);
  });

  it("BUG-0278: throws CheckpointCorruptError when threadId is missing", async () => {
    const raw = JSON.stringify({
      step: 0, state: {}, nextNodes: [], timestamp: Date.now(), pendingSends: [],
      // threadId deliberately omitted
    });
    injectRaw("missing-thread-id", 0, raw);
    await expect(cp.get("missing-thread-id")).rejects.toThrow(CheckpointCorruptError);
    await expect(cp.get("missing-thread-id")).rejects.toThrow(/threadId/i);
  });

  it("BUG-0278: throws CheckpointCorruptError when threadId is not a string", async () => {
    const raw = JSON.stringify({
      threadId: 42, step: 0, state: {}, nextNodes: [], timestamp: Date.now(), pendingSends: [],
    });
    injectRaw("bad-thread-id", 0, raw);
    await expect(cp.get("bad-thread-id")).rejects.toThrow(CheckpointCorruptError);
  });

  it("BUG-0278: throws CheckpointCorruptError when step is not a finite number", async () => {
    const raw = JSON.stringify({
      threadId: "t-step", step: "NaN", state: {}, nextNodes: [], timestamp: Date.now(), pendingSends: [],
    });
    injectRaw("bad-step", 0, raw);
    await expect(cp.get("bad-step")).rejects.toThrow(CheckpointCorruptError);
    await expect(cp.get("bad-step")).rejects.toThrow(/step/i);
  });

  it("BUG-0278: throws CheckpointCorruptError when timestamp is missing or non-finite", async () => {
    const raw = JSON.stringify({
      threadId: "t-ts", step: 0, state: {}, nextNodes: [], pendingSends: [],
      // timestamp omitted
    });
    injectRaw("missing-ts", 0, raw);
    await expect(cp.get("missing-ts")).rejects.toThrow(CheckpointCorruptError);
    await expect(cp.get("missing-ts")).rejects.toThrow(/timestamp/i);
  });

  it("BUG-0278: throws CheckpointCorruptError when state field is missing entirely", async () => {
    const raw = JSON.stringify({
      threadId: "t-state", step: 0, nextNodes: [], timestamp: Date.now(), pendingSends: [],
      // state omitted
    });
    injectRaw("missing-state", 0, raw);
    await expect(cp.get("missing-state")).rejects.toThrow(CheckpointCorruptError);
    await expect(cp.get("missing-state")).rejects.toThrow(/state/i);
  });

  it("BUG-0278: throws CheckpointCorruptError when nextNodes is not an array", async () => {
    const raw = JSON.stringify({
      threadId: "t-nn", step: 0, state: {}, nextNodes: "not-array",
      timestamp: Date.now(), pendingSends: [],
    });
    injectRaw("bad-next-nodes", 0, raw);
    await expect(cp.get("bad-next-nodes")).rejects.toThrow(CheckpointCorruptError);
    await expect(cp.get("bad-next-nodes")).rejects.toThrow(/nextNodes/i);
  });

  it("BUG-0278: corrupt entry is detectable via list() as well as get()", async () => {
    injectRaw("list-corrupt", 0, "{{bad json");
    await expect(cp.list("list-corrupt")).rejects.toThrow(CheckpointCorruptError);
  });
});
