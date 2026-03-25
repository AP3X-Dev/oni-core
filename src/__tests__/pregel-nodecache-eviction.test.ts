/**
 * BUG-0446: nodeCache FIFO eviction was not atomic — concurrent node
 * executions could both observe size > 256, both delete the oldest key,
 * and both insert, allowing the map to grow past its 256-entry cap.
 *
 * Fix: replaced the old single-delete with a post-insert while-loop so that
 * regardless of how many concurrent writers race, the cache self-corrects
 * back to ≤ 256 entries after each insert.
 */

import { describe, it, expect } from "vitest";

const NODE_CACHE_MAX_SIZE = 256;

/**
 * Simulate the fixed eviction logic from execution.ts in isolation.
 * The while loop is the fix — it keeps evicting until the map is back
 * within bounds, making it self-correcting under concurrency.
 */
function insertWithEviction(
  cache: Map<string, unknown>,
  key: string,
  value: unknown,
) {
  cache.set(key, value);
  while (cache.size > NODE_CACHE_MAX_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

describe("nodeCache eviction (BUG-0446)", () => {
  it("cache stays at or below NODE_CACHE_MAX_SIZE after sequential inserts", () => {
    const cache = new Map<string, unknown>();

    for (let i = 0; i < NODE_CACHE_MAX_SIZE + 50; i++) {
      insertWithEviction(cache, `key-${i}`, { result: i });
    }

    expect(cache.size).toBeLessThanOrEqual(NODE_CACHE_MAX_SIZE);
  });

  it("while-loop self-corrects when cache is artificially over-filled (simulates concurrent insert race)", () => {
    const cache = new Map<string, unknown>();

    // Pre-fill to exactly the max
    for (let i = 0; i < NODE_CACHE_MAX_SIZE; i++) {
      cache.set(`key-${i}`, i);
    }
    expect(cache.size).toBe(NODE_CACHE_MAX_SIZE);

    // Simulate two concurrent writers both inserting without eviction first
    // (the old bug: each deletes one, each inserts one → map grows to max+1)
    cache.set("race-a", "a");
    cache.set("race-b", "b");
    // Now size = max + 2, simulating the over-filled state

    // Apply the while-loop fix
    while (cache.size > NODE_CACHE_MAX_SIZE) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }

    expect(cache.size).toBeLessThanOrEqual(NODE_CACHE_MAX_SIZE);
  });

  it("oldest entries are evicted first (FIFO order preserved)", () => {
    const cache = new Map<string, unknown>();

    // Fill to max
    for (let i = 0; i < NODE_CACHE_MAX_SIZE; i++) {
      cache.set(`key-${i}`, i);
    }

    // Insert one more — should evict key-0 (oldest)
    insertWithEviction(cache, "new-key", "new");

    expect(cache.has("key-0")).toBe(false);
    expect(cache.has("new-key")).toBe(true);
    expect(cache.size).toBe(NODE_CACHE_MAX_SIZE);
  });
});
