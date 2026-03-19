import { describe, it, expect, vi } from "vitest";
import { RedisStore } from "../redis/index.js";
import type { RedisClient } from "../redis/types.js";

describe("RedisStore key encoding", () => {
  it("BUG-0242: should encode keys with colons to prevent key-space traversal", async () => {
    const evalSpy = vi.fn().mockResolvedValue("OK");

    const mockClient: RedisClient = {
      set: vi.fn(),
      get: vi.fn(),
      del: vi.fn(),
      zadd: vi.fn(),
      zrange: vi.fn().mockResolvedValue([]),
      zrem: vi.fn(),
      keys: vi.fn().mockResolvedValue([]),
      eval: evalSpy,
    };

    // Bypass private constructor to inject mock client
    const store = Object.create(RedisStore.prototype) as RedisStore;
    Object.assign(store, { client: mockClient, prefix: "test" });

    // A malicious key containing colons that could traverse into another key-space
    const maliciousKey = "x:oni:store:admin:secret";
    await store.put(["ns"], maliciousKey, { data: "payload" });

    expect(evalSpy).toHaveBeenCalledOnce();

    // The data key (KEYS[1]) must contain the encoded key, not the raw key
    const dataKeyArg = evalSpy.mock.calls[0]![2] as string;
    // The raw malicious key with colons should NOT appear unencoded in the Redis key
    expect(dataKeyArg).not.toContain(`:${maliciousKey}`);
    // Instead, it should contain the URI-encoded version
    expect(dataKeyArg).toContain(encodeURIComponent(maliciousKey));
  });

  it("BUG-0242: encoded keys should not collide across namespaces", async () => {
    const evalSpy = vi.fn().mockResolvedValue("OK");

    const mockClient: RedisClient = {
      set: vi.fn(),
      get: vi.fn(),
      del: vi.fn(),
      zadd: vi.fn(),
      zrange: vi.fn().mockResolvedValue([]),
      zrem: vi.fn(),
      keys: vi.fn().mockResolvedValue([]),
      eval: evalSpy,
    };

    const store = Object.create(RedisStore.prototype) as RedisStore;
    Object.assign(store, { client: mockClient, prefix: "test" });

    await store.put(["ns-a"], "key:with:colons", "val1");
    await store.put(["ns-b"], "key:with:colons", "val2");

    // Two puts should produce different Redis keys (different namespaces)
    const key1 = evalSpy.mock.calls[0]![2] as string;
    const key2 = evalSpy.mock.calls[1]![2] as string;
    expect(key1).not.toBe(key2);
  });
});
