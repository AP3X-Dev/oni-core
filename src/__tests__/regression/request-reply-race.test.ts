import { describe, it, expect, vi } from "vitest";
import { RequestReplyBroker } from "../../coordination/request-reply.js";

describe("regression: BUG-0330 reply() race with timeout", () => {
  it("BUG-0330: concurrent reply() and timeout do not double-settle the promise", async () => {
    vi.useFakeTimers();

    const broker = new RequestReplyBroker();
    const { requestId, promise } = broker.request("a", "b", "payload", {
      timeoutMs: 100,
    });

    // Simulate timeout firing first — advances past the timeout window
    vi.advanceTimersByTime(200);

    // The promise should now be rejected by the timeout
    await expect(promise).rejects.toThrow(/timed out/);

    // reply() called after timeout expiry must throw — the pending entry has
    // been removed and calling reply() should not silently double-settle
    expect(() => broker.reply(requestId, "late-reply")).toThrow(
      `No pending request with id ${requestId}`
    );

    vi.useRealTimers();
  });

  it("BUG-0330: reply() before timeout resolves promise and subsequent timeout is a no-op", async () => {
    vi.useFakeTimers();

    const broker = new RequestReplyBroker();
    const { requestId, promise } = broker.request("a", "b", "payload", {
      timeoutMs: 100,
    });

    // Reply arrives before timeout
    broker.reply(requestId, { result: "ok" });
    await expect(promise).resolves.toEqual({ result: "ok" });

    // Advance past timeout — no error should be thrown (the timeout is a no-op)
    expect(() => vi.advanceTimersByTime(200)).not.toThrow();

    vi.useRealTimers();
  });
});
