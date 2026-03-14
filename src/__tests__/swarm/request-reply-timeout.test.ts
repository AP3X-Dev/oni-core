import { describe, it, expect } from "vitest";
import { RequestReplyBroker } from "../../coordination/request-reply.js";

describe("Request/reply timeout", () => {
  it("rejects the promise when timeout expires before reply", async () => {
    const broker = new RequestReplyBroker();
    const { promise } = broker.request("agent-a", "agent-b", { query: "hello" }, { timeoutMs: 50 });

    // No one replies → should reject after 50ms
    await expect(promise).rejects.toThrow("timed out");

    // Request should be marked resolved (timed out)
    expect(broker.hasPending("agent-b")).toBe(false);
  });

  it("resolves normally when reply arrives before timeout", async () => {
    const broker = new RequestReplyBroker();
    const { requestId, promise } = broker.request("agent-a", "agent-b", { query: "hello" }, { timeoutMs: 5000 });

    // Reply quickly
    broker.reply(requestId, { answer: "world" });

    const result = await promise;
    expect(result).toEqual({ answer: "world" });
    expect(broker.hasPending("agent-b")).toBe(false);
  });

  it("does not timeout when no timeoutMs is provided (backward compatible)", async () => {
    const broker = new RequestReplyBroker();
    const { requestId, promise } = broker.request("agent-a", "agent-b", { query: "hello" });

    // Reply after a small delay
    setTimeout(() => broker.reply(requestId, "late reply"), 20);

    const result = await promise;
    expect(result).toBe("late reply");
  });
});

describe("Request/reply cleanup regression", () => {
  it("completed requests are removed from pending so memory does not accumulate", async () => {
    const broker = new RequestReplyBroker();

    // Complete 3 request/reply cycles
    for (let i = 0; i < 3; i++) {
      const { requestId, promise } = broker.request("a", "b", { i });
      broker.reply(requestId, `resp-${i}`);
      await promise;
    }

    // Internal pending map must be empty — no accumulation
    expect((broker as any).pending.size).toBe(0);
  });

  it("timeout clears the timer so the process is not held open", async () => {
    const broker = new RequestReplyBroker();
    const { requestId, promise } = broker.request("a", "b", {}, { timeoutMs: 30 });

    // Reply before timeout fires
    broker.reply(requestId, "fast");
    await promise;

    // Timer handle must have been cleared (timeouts map is empty)
    expect((broker as any).timeouts.size).toBe(0);
  });

  it("pending map is cleared on timeout as well as on reply", async () => {
    const broker = new RequestReplyBroker();
    const { promise } = broker.request("a", "b", {}, { timeoutMs: 20 });

    await expect(promise).rejects.toThrow("timed out");

    // Timed-out entry must not remain in pending
    expect((broker as any).pending.size).toBe(0);
    expect((broker as any).timeouts.size).toBe(0);
  });

  it("late reply after timeout does not throw (pending is gone)", async () => {
    const broker = new RequestReplyBroker();
    const { requestId, promise } = broker.request("a", "b", {}, { timeoutMs: 20 });

    await expect(promise).rejects.toThrow("timed out");

    // A late reply on an already-cleaned-up request should throw (no pending entry)
    expect(() => broker.reply(requestId, "late")).toThrow("No pending request");
  });
});
