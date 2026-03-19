import { describe, it, expect, vi } from "vitest";
import { RedisStore } from "../redis/index.js";
import type { RedisClient } from "../redis/types.js";

describe("RedisStore.delete atomicity", () => {
  it("BUG-0073: should use atomic Lua eval instead of separate DEL+ZREM to prevent stale index entries", async () => {
    const evalSpy = vi.fn().mockResolvedValue("OK");
    const delSpy = vi.fn();
    const zremSpy = vi.fn();

    const mockClient: RedisClient = {
      set: vi.fn(),
      get: vi.fn(),
      del: delSpy,
      zadd: vi.fn(),
      zrange: vi.fn().mockResolvedValue([]),
      zrem: zremSpy,
      keys: vi.fn().mockResolvedValue([]),
      eval: evalSpy,
    };

    // Bypass private constructor to inject mock client
    const store = Object.create(RedisStore.prototype) as RedisStore;
    Object.assign(store, { client: mockClient, prefix: "test" });

    await store.delete(["ns"], "key1");

    // The fix: delete() must use a single atomic eval (Lua script), NOT separate del + zrem.
    // Before the fix, a process crash between DEL and ZREM would leave a stale index entry
    // that causes list() to perform unnecessary round-trips for every orphaned key indefinitely.
    expect(evalSpy).toHaveBeenCalledOnce();
    expect(delSpy).not.toHaveBeenCalled();
    expect(zremSpy).not.toHaveBeenCalled();

    // The Lua script must perform both DEL and ZREM atomically
    const luaScript = evalSpy.mock.calls[0]![0] as string;
    expect(luaScript).toContain("DEL");
    expect(luaScript).toContain("ZREM");
  });
});
