import { describe, it, expect } from "vitest";
import { TokenStreamWriter } from "../streaming.js";

/**
 * Regression tests for BUG-0416: TokenStreamWriter lost-token race between
 * push() and end().
 *
 * Pre-fix behaviour: end() set done=true before draining waiters. A token
 * push()ed after the iterator's last queue check but before end() resolved
 * the waiter would be left in the queue after the null signal, causing the
 * iterator to exit without yielding it.
 *
 * Fix:
 *   1. end() now sets done=true AFTER draining waiters.
 *   2. The iterator flushes remaining queue items upon receiving null from
 *      a waiter, catching any tokens push()ed during the race window.
 */

async function collectAll(writer: TokenStreamWriter): Promise<string[]> {
  const result: string[] = [];
  for await (const token of writer) {
    result.push(token);
  }
  return result;
}

describe("BUG-0416: TokenStreamWriter push/end race — no tokens dropped", () => {
  it("yields all tokens pushed before end()", async () => {
    const writer = new TokenStreamWriter();
    writer.push("a");
    writer.push("b");
    writer.push("c");
    writer.end();
    const tokens = await collectAll(writer);
    expect(tokens).toEqual(["a", "b", "c"]);
  });

  it("yields tokens pushed after end() resolves waiter (race window)", async () => {
    // Simulate the race: iterator is waiting on a waiter promise when end()
    // fires, and a concurrent push() adds a token between the waiter being
    // resolved (null) and the iterator returning.
    const writer = new TokenStreamWriter();

    // Start the consumer — it will suspend waiting for tokens.
    const resultPromise = collectAll(writer);

    // Yield to let the async generator reach the await-waiter branch.
    await Promise.resolve();

    // Now end() fires — resolves waiter with null — then push() adds a token
    // that lands in the queue. The fix flushes this queue before returning.
    writer.end();
    writer.push("late-token");

    const tokens = await resultPromise;
    expect(tokens).toContain("late-token");
  });

  it("yields tokens interleaved with waiter resolution", async () => {
    const writer = new TokenStreamWriter();

    const resultPromise = collectAll(writer);

    // Allow generator to reach wait state.
    await Promise.resolve();

    writer.push("x");
    writer.push("y");
    writer.end();

    const tokens = await resultPromise;
    expect(tokens).toEqual(["x", "y"]);
  });

  it("empty stream ends cleanly with no tokens", async () => {
    const writer = new TokenStreamWriter();
    writer.end();
    const tokens = await collectAll(writer);
    expect(tokens).toEqual([]);
  });

  it("large batch of tokens all collected after end()", async () => {
    const writer = new TokenStreamWriter();
    const N = 200;
    for (let i = 0; i < N; i++) {
      writer.push(`t${i}`);
    }
    writer.end();
    const tokens = await collectAll(writer);
    expect(tokens).toHaveLength(N);
    expect(tokens[0]).toBe("t0");
    expect(tokens[N - 1]).toBe(`t${N - 1}`);
  });

  it("push after end does not hang the consumer", async () => {
    const writer = new TokenStreamWriter();
    const resultPromise = collectAll(writer);
    await Promise.resolve();
    writer.end();
    writer.push("after-end");
    // Should resolve — not hang.
    const tokens = await resultPromise;
    // "after-end" may or may not be flushed depending on timing, but the
    // consumer must not hang indefinitely.
    expect(Array.isArray(tokens)).toBe(true);
  });
});
