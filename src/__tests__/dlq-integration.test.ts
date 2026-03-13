import { describe, it, expect } from "vitest";
import { StateGraph, START, END, lastValue } from "../index.js";

describe("DLQ integration", () => {
  it("failed node gets captured in DLQ when enabled", async () => {
    type S = { value: string };
    const g = new StateGraph<S>({ channels: { value: lastValue(() => "") } });
    g.addNode("failing", async () => {
      throw new Error("node-boom");
    });
    g.addEdge(START, "failing");
    g.addEdge("failing", END);
    const app = g.compile({ deadLetterQueue: true });

    const threadId = "dlq-test-1";
    await expect(app.invoke({ value: "hi" }, { threadId })).rejects.toThrow("node-boom");

    const deadLetters = app.getDeadLetters!({ threadId });
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0].node).toBe("failing");
    expect(deadLetters[0].error.message).toBe("node-boom");
    expect(deadLetters[0].attempts).toBe(1);
  });

  it("failed node with retry records correct attempt count", async () => {
    type S = { value: string };
    const g = new StateGraph<S>({ channels: { value: lastValue(() => "") } });
    g.addNode("retryFail", async () => {
      throw new Error("still-broken");
    }, { retry: { maxAttempts: 3 } });
    g.addEdge(START, "retryFail");
    g.addEdge("retryFail", END);
    const app = g.compile({ deadLetterQueue: true });

    const threadId = "dlq-test-retry";
    await expect(app.invoke({ value: "hi" }, { threadId })).rejects.toThrow("still-broken");

    const deadLetters = app.getDeadLetters!({ threadId });
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0].node).toBe("retryFail");
    expect(deadLetters[0].attempts).toBe(3);
  });

  it("DLQ is empty when disabled", async () => {
    type S = { value: string };
    const g = new StateGraph<S>({ channels: { value: lastValue(() => "") } });
    g.addNode("failing", async () => {
      throw new Error("node-boom");
    });
    g.addEdge(START, "failing");
    g.addEdge("failing", END);
    const app = g.compile(); // No deadLetterQueue option

    const threadId = "dlq-test-disabled";
    await expect(app.invoke({ value: "hi" }, { threadId })).rejects.toThrow("node-boom");

    // getDeadLetters still works but returns empty when DLQ is not enabled
    const deadLetters = app.getDeadLetters!({ threadId });
    expect(deadLetters).toHaveLength(0);
  });

  it("successful nodes do not appear in DLQ", async () => {
    type S = { value: string };
    const g = new StateGraph<S>({ channels: { value: lastValue(() => "") } });
    g.addNode("ok", async () => ({ value: "done" }));
    g.addEdge(START, "ok");
    g.addEdge("ok", END);
    const app = g.compile({ deadLetterQueue: true });

    const threadId = "dlq-test-ok";
    const result = await app.invoke({ value: "hi" }, { threadId });
    expect(result.value).toBe("done");

    const deadLetters = app.getDeadLetters!({ threadId });
    expect(deadLetters).toHaveLength(0);
  });
});
