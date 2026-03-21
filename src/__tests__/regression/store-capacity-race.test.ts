import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../store/index.js";

describe("regression: BUG-0331 InMemoryStore concurrent put() capacity enforcement", () => {
  it("BUG-0331: concurrent puts with embedFn do not exceed maxItems", async () => {
    // Slow embedFn to create an async gap where concurrent puts can race
    const embedFn = async (_text: string): Promise<number[]> => {
      await new Promise((r) => setTimeout(r, 5));
      return [1, 0, 0];
    };

    const maxItems = 2;
    const store = new InMemoryStore({ embedFn, maxItems });

    // Fill to capacity with sequential puts
    await store.put(["ns"], "k1", "v1");
    await store.put(["ns"], "k2", "v2");

    // Both concurrent puts target new keys — at least one must be rejected
    // when the store is already at capacity and no TTLs exist for eviction
    const p1 = store.put(["ns"], "k3", "v3");
    const p2 = store.put(["ns"], "k4", "v4");

    const results = await Promise.allSettled([p1, p2]);

    // At least one must have been rejected (capacity exceeded)
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected.length).toBeGreaterThanOrEqual(1);

    // The store must not have grown beyond maxItems
    expect(store.size()).toBeLessThanOrEqual(maxItems);
  });

  it("BUG-0331: put() without embedFn enforces capacity synchronously", async () => {
    const store = new InMemoryStore({ maxItems: 1 });
    await store.put(["ns"], "k1", "v1");

    // Second put for a new key must throw immediately
    await expect(store.put(["ns"], "k2", "v2")).rejects.toThrow(
      /max capacity reached/
    );

    expect(store.size()).toBe(1);
  });
});
