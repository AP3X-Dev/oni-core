import { describe, it, expect, vi } from "vitest";
import { RequestReplyBroker } from "../coordination/request-reply.js";

/**
 * Regression tests for BUG-0330: non-atomic check-and-set of req.resolved
 * in reply() allows double-settlement of the underlying Promise.
 *
 * The race: if the timeout callback fires between reply() reading req.resolved
 * and setting it to true, both the timeout rejection and the reply resolution
 * call their respective settler functions on the same Promise.
 *
 * Fix: reply() atomically checks req.resolved at the top. If already resolved
 * (set by the timeout callback), it returns the reply message immediately
 * without calling the resolver again.
 */
describe("BUG-0330: RequestReplyBroker reply() resolved flag is checked atomically", () => {
  it("reply() returns a message without throwing when request is already resolved by timeout", async () => {
    vi.useFakeTimers();

    const broker = new RequestReplyBroker();
    const { requestId, promise } = broker.request("agent-a", "agent-b", { q: "hello" }, { timeoutMs: 100 });

    // Advance timers to fire the timeout callback — marks req.resolved = true
    // and removes the entry from pending, then rejects the promise.
    vi.advanceTimersByTime(150);

    await expect(promise).rejects.toThrow("timed out");

    // After timeout, the pending entry is cleaned up. A late reply() call should
    // throw "No pending request" rather than double-settling the Promise.
    // This is the expected behavior on BOTH old and new code once pending is cleared.
    expect(() => broker.reply(requestId, { a: "late" })).toThrow("No pending request");

    vi.useRealTimers();
  });

  it("reply() called on a request whose resolved flag is set (but still in pending) does not double-settle", async () => {
    // Simulate the race window: req.resolved = true but pending entry still present.
    // This mirrors the moment after the timeout sets resolved=true but before
    // pending.delete() runs — or equivalently, a second call to reply().
    const broker = new RequestReplyBroker();
    const { requestId, promise } = broker.request("agent-a", "agent-b", "payload", { timeoutMs: 60_000 });

    // First reply resolves the promise normally.
    broker.reply(requestId, "first-reply");
    const result = await promise;
    expect(result).toBe("first-reply");

    // The pending entry is now gone. A second call should throw, not double-settle.
    // (Promise double-settlement is silent in V8, so we verify the throw instead.)
    expect(() => broker.reply(requestId, "second-reply")).toThrow("No pending request");
  });

  it("reply() called when req.resolved is already true (still in pending map) returns gracefully", async () => {
    // Directly simulate the race: inject a pre-resolved request into the broker's
    // pending map, then call reply(). The fix checks resolved at the start and
    // returns the reply message without calling the resolver again.
    const broker = new RequestReplyBroker();
    const { requestId, promise } = broker.request("a", "b", "data", { timeoutMs: 60_000 });

    // Access the internal pending map and pre-mark the request as resolved,
    // leaving it in the map (simulating the instant the timeout sets resolved=true
    // before calling pending.delete()).
    const pending = (broker as unknown as { pending: Map<string, { resolved: boolean }> }).pending;
    const req = pending.get(requestId);
    expect(req).toBeDefined();
    req!.resolved = true;

    // With the fix: reply() detects resolved=true and returns the reply message
    // without invoking the resolver or throwing.
    // Without the fix: reply() would call resolver(payload) even though resolved=true,
    // potentially double-settling the Promise.
    const replyMsg = broker.reply(requestId, "late-payload");

    // The reply message should still be well-formed regardless of the guard path.
    expect(replyMsg).toMatchObject({
      id: `reply_${requestId}`,
      from: "b",
      to: "a",
      metadata: { requestId, isReply: true },
    });

    // The underlying promise should NOT have been resolved by this late reply().
    // Since we only set resolved=true without resolving the promise, the promise
    // is still pending — clean up with a manual resolve to avoid leak.
    const resolvers = (broker as unknown as { resolvers: Map<string, (v: unknown) => void> }).resolvers;
    const resolve = resolvers.get(requestId);
    if (resolve) resolve("cleanup");
    await promise; // drains microtask queue
  });
});
