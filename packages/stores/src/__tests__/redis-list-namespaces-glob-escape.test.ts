import { describe, it, expect, vi } from "vitest";
import { RedisStore } from "../redis/index.js";
import type { RedisClient } from "../redis/types.js";

// BUG-0284: RedisStore.listNamespaces() constructed the KEYS glob pattern
// as `oni:store:idx:${this.prefix}:*` without escaping Redis glob metacharacters
// (* ? [ ]) in the prefix. A prefix like `*` would scan the entire keyspace,
// and a crafted prefix with `[a-z]` could match unintended keys.
// Fix: escape metacharacters via prefix.replace(/([*?[\]])/g, '\\$1') before
// constructing the KEYS pattern.

function makeStoreWithPrefix(prefix: string, returnedKeys: string[]): RedisStore {
  const mockClient: RedisClient = {
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
    zadd: vi.fn(),
    zrange: vi.fn().mockResolvedValue([]),
    zrem: vi.fn(),
    keys: vi.fn().mockResolvedValue(returnedKeys),
    eval: vi.fn().mockResolvedValue("OK"),
  };

  const store = Object.create(RedisStore.prototype) as RedisStore;
  Object.assign(store, { client: mockClient, prefix });
  return store;
}

describe("BUG-0284: RedisStore.listNamespaces() escapes glob metacharacters in prefix", () => {
  it("BUG-0284: an asterisk in the prefix is escaped before use in KEYS pattern", async () => {
    const keysSpy = vi.fn().mockResolvedValue([]);
    const mockClient: RedisClient = {
      set: vi.fn(), get: vi.fn(), del: vi.fn(),
      zadd: vi.fn(), zrange: vi.fn().mockResolvedValue([]),
      zrem: vi.fn(), keys: keysSpy, eval: vi.fn(),
    };

    const store = Object.create(RedisStore.prototype) as RedisStore;
    Object.assign(store, { client: mockClient, prefix: "te*st" });

    await store.listNamespaces();

    expect(keysSpy).toHaveBeenCalledOnce();
    const pattern: string = keysSpy.mock.calls[0]![0];
    // The raw * should be escaped to \* in the Redis KEYS pattern
    expect(pattern).toContain("te\\*st");
    // The unescaped wildcard prefix must NOT appear literally
    expect(pattern).not.toMatch(/oni:store:idx:te\*st:/);
    // But should end with the trailing glob wildcard for namespace enumeration
    expect(pattern).toMatch(/\*$/);
  });

  it("BUG-0284: a question mark in the prefix is escaped", async () => {
    const keysSpy = vi.fn().mockResolvedValue([]);
    const mockClient: RedisClient = {
      set: vi.fn(), get: vi.fn(), del: vi.fn(),
      zadd: vi.fn(), zrange: vi.fn().mockResolvedValue([]),
      zrem: vi.fn(), keys: keysSpy, eval: vi.fn(),
    };

    const store = Object.create(RedisStore.prototype) as RedisStore;
    Object.assign(store, { client: mockClient, prefix: "te?st" });

    await store.listNamespaces();

    const pattern: string = keysSpy.mock.calls[0]![0];
    expect(pattern).toContain("te\\?st");
  });

  it("BUG-0284: square-bracket range expression in prefix is escaped", async () => {
    const keysSpy = vi.fn().mockResolvedValue([]);
    const mockClient: RedisClient = {
      set: vi.fn(), get: vi.fn(), del: vi.fn(),
      zadd: vi.fn(), zrange: vi.fn().mockResolvedValue([]),
      zrem: vi.fn(), keys: keysSpy, eval: vi.fn(),
    };

    const store = Object.create(RedisStore.prototype) as RedisStore;
    Object.assign(store, { client: mockClient, prefix: "te[a-z]st" });

    await store.listNamespaces();

    const pattern: string = keysSpy.mock.calls[0]![0];
    expect(pattern).toContain("te\\[a-z\\]st");
  });

  it("BUG-0284: a safe prefix without metacharacters passes through unchanged", async () => {
    const keysSpy = vi.fn().mockResolvedValue([]);
    const mockClient: RedisClient = {
      set: vi.fn(), get: vi.fn(), del: vi.fn(),
      zadd: vi.fn(), zrange: vi.fn().mockResolvedValue([]),
      zrem: vi.fn(), keys: keysSpy, eval: vi.fn(),
    };

    const store = Object.create(RedisStore.prototype) as RedisStore;
    Object.assign(store, { client: mockClient, prefix: "safe-prefix" });

    await store.listNamespaces();

    const pattern: string = keysSpy.mock.calls[0]![0];
    expect(pattern).toContain("oni:store:idx:safe-prefix:");
  });
});
