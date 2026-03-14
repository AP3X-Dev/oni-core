import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../store/index.js";

// Simple mock embedding: bag-of-bigrams model for reasonable similarity
function mockEmbed(text: string): number[] {
  const DIM = 32;
  const vec = new Array(DIM).fill(0);
  const lower = text.toLowerCase();
  for (let i = 0; i < lower.length - 1; i++) {
    const bigram = lower.charCodeAt(i) * 256 + lower.charCodeAt(i + 1);
    vec[bigram % DIM] += 1;
  }
  // Normalize
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return mag > 0 ? vec.map((v) => v / mag) : vec;
}

describe("Semantic search", () => {
  it("uses embeddings when configured", async () => {
    const store = new InMemoryStore({
      embedFn: async (text) => mockEmbed(text),
    });

    await store.put(["docs"], "doc1", { text: "TypeScript guide" });
    await store.put(["docs"], "doc2", { text: "Python tutorial" });
    await store.put(["docs"], "doc3", { text: "JavaScript basics" });

    const results = await store.search(["docs"], "TypeScript");
    expect(results.length).toBeGreaterThan(0);
    // TypeScript guide should rank highest
    expect(results[0].item.key).toBe("doc1");
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("falls back to substring search without embeddings", async () => {
    const store = new InMemoryStore();
    await store.put(["docs"], "doc1", "hello world");
    await store.put(["docs"], "doc2", "goodbye world");

    const results = await store.search(["docs"], "hello");
    expect(results.length).toBe(1);
    expect(results[0].item.key).toBe("doc1");
  });

  it("respects limit parameter", async () => {
    const store = new InMemoryStore({
      embedFn: async (text) => mockEmbed(text),
    });

    for (let i = 0; i < 10; i++) {
      await store.put(["docs"], `doc${i}`, { text: `document ${i}` });
    }

    const results = await store.search(["docs"], "document", { limit: 3 });
    expect(results.length).toBe(3);
  });
});

describe("InMemoryStore TTL cleanup regression", () => {
  it("list() purges expired entries from the internal map (no memory leak)", async () => {
    const store = new InMemoryStore();
    const ns = ["ttl-test"];

    await store.put(ns, "short", "value", { ttl: 1 });   // expires in 1ms
    await store.put(ns, "long",  "value", { ttl: 60_000 }); // far future

    // Wait for the short-lived entry to expire
    await new Promise((r) => setTimeout(r, 10));

    const visible = await store.list(ns);
    expect(visible.length).toBe(1);
    expect(visible[0].key).toBe("long");

    // The underlying data map must have been pruned — expired entry deleted
    expect((store as any).data.size).toBe(1);
  });

  it("size() purges expired entries from the internal map", async () => {
    const store = new InMemoryStore();
    const ns = ["size-test"];

    await store.put(ns, "a", "val", { ttl: 1 });
    await store.put(ns, "b", "val", { ttl: 60_000 });

    await new Promise((r) => setTimeout(r, 10));

    expect(store.size()).toBe(1);
    expect((store as any).data.size).toBe(1); // expired entry removed
  });

  it("list() purges expired vectors when embeddings are enabled", async () => {
    const store = new InMemoryStore({ embedFn: async (t) => mockEmbed(t) });
    const ns = ["vec-test"];

    await store.put(ns, "soon", "expires", { ttl: 1 });
    await store.put(ns, "later", "persists", { ttl: 60_000 });

    await new Promise((r) => setTimeout(r, 10));

    await store.list(ns);

    // vectors map must not retain the expired entry
    const vectors = (store as any).vectors as Map<string, unknown>;
    const keys = [...vectors.keys()];
    expect(keys.every((k) => !k.includes("soon"))).toBe(true);
    expect(keys.some((k) => k.includes("later"))).toBe(true);
  });
});
