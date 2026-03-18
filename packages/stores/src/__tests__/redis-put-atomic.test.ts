import { describe, it, expect, vi } from "vitest";
import { RedisStore } from "../redis/index.js";
import type { RedisClient } from "../redis/types.js";

describe("RedisStore.put atomicity", () => {
  it("BUG-0006: should use atomic Lua eval instead of separate GET+SET to prevent createdAt race", async () => {
    const evalSpy = vi.fn().mockResolvedValue("OK");
    const getSpy = vi.fn();
    const setSpy = vi.fn();

    const mockClient: RedisClient = {
      set: setSpy,
      get: getSpy,
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

    await store.put(["ns"], "key1", { hello: "world" });

    // The fix: put() must use a single atomic eval (Lua script), NOT separate get + set
    expect(evalSpy).toHaveBeenCalledOnce();
    expect(getSpy).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();

    // The Lua script must preserve existing createdAt
    const luaScript = evalSpy.mock.calls[0]![0] as string;
    expect(luaScript).toContain("createdAt");
    expect(luaScript).toContain("GET");
    expect(luaScript).toContain("SET");
  });
});
