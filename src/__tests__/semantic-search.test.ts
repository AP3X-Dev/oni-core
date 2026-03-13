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
