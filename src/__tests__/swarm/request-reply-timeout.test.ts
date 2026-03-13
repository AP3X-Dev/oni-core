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
