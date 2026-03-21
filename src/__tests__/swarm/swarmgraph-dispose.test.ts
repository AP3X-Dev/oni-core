import { describe, it, expect } from "vitest";
import { RequestReplyBroker } from "../../coordination/request-reply.js";

// Regression tests for BUG-0327:
// SwarmGraph lazily creates a RequestReplyBroker (with active setTimeout
// handles) and a PubSub (with subscriber maps) but originally exposed no
// dispose() method, allowing timer handles and subscriber maps to leak when
// the graph was discarded.
//
// The fix adds:
//   - RequestReplyBroker.dispose()  — clears pending timeouts and rejects
//     all pending promises, preventing timer handle leaks.
//   - PubSub.dispose()              — clears subscriber maps and buffer.
//   - SwarmGraph.dispose()          — delegates to broker.dispose() and
//     pubsub.dispose() and nulls the references for GC.
//
// These tests cover RequestReplyBroker.dispose() which was the first
// component-level fix and is already present on main. They also document
// the full expected behavior to guard against regressions when the
// SwarmGraph-level wiring is added.

describe("RequestReplyBroker.dispose() — BUG-0327 component regression", () => {
  it("clears all pending timeout handles so the process is not held open", async () => {
    const broker = new RequestReplyBroker();

    // A long-lived pending request installs a setTimeout handle
    const { promise } = broker.request("a", "b", {}, { timeoutMs: 60_000 });

    expect((broker as any).timeouts.size).toBe(1);
    expect((broker as any).pending.size).toBe(1);

    broker.dispose();

    // Timer handles must be cleared immediately
    expect((broker as any).timeouts.size).toBe(0);
    expect((broker as any).pending.size).toBe(0);
    expect((broker as any).resolvers.size).toBe(0);
    expect((broker as any).rejectors.size).toBe(0);

    // The pending promise must reject (not hang forever)
    await expect(promise).rejects.toThrow("cancelled: broker disposed");
  });

  it("clears multiple concurrent pending requests on dispose", async () => {
    const broker = new RequestReplyBroker();

    const { promise: p1 } = broker.request("a", "b", {}, { timeoutMs: 30_000 });
    const { promise: p2 } = broker.request("a", "c", {}, { timeoutMs: 30_000 });
    const { promise: p3 } = broker.request("b", "c", {}, { timeoutMs: 30_000 });

    expect((broker as any).timeouts.size).toBe(3);

    broker.dispose();

    expect((broker as any).timeouts.size).toBe(0);
    expect((broker as any).pending.size).toBe(0);

    // All promises must reject
    await Promise.all([
      expect(p1).rejects.toThrow("cancelled: broker disposed"),
      expect(p2).rejects.toThrow("cancelled: broker disposed"),
      expect(p3).rejects.toThrow("cancelled: broker disposed"),
    ]);
  });

  it("is idempotent — safe to call dispose() on an empty broker", () => {
    const broker = new RequestReplyBroker();
    expect(() => broker.dispose()).not.toThrow();
    expect(() => broker.dispose()).not.toThrow(); // second call also safe
  });

  it("does not affect already-resolved requests", async () => {
    const broker = new RequestReplyBroker();

    const { requestId, promise } = broker.request("a", "b", {}, { timeoutMs: 5_000 });
    broker.reply(requestId, { result: "ok" });

    // Request is already resolved — no pending entry remains
    expect((broker as any).pending.size).toBe(0);

    // dispose() on a broker with no pending requests is a no-op for promises
    broker.dispose();

    // The already-resolved promise is unaffected
    await expect(promise).resolves.toEqual({ result: "ok" });
  });
});
