import { describe, it, expect } from "vitest";
import { StateGraph, START, END, lastValue } from "../index.js";
import { CircuitBreakerOpenError } from "../errors.js";

describe("circuit breaker integration", () => {
  it("trips after threshold failures through graph execution", async () => {
    type S = { value: string };
    let callCount = 0;

    const g = new StateGraph<S>({ channels: { value: lastValue(() => "") } });
    g.addNode("flaky", async () => {
      callCount++;
      throw new Error("boom");
    }, {
      circuitBreaker: { threshold: 2, resetAfter: 60000 },
    });
    g.addEdge(START, "flaky");
    g.addEdge("flaky", END);
    const app = g.compile();

    // First two calls fail with the original error (threshold not yet reached on first, reached on second)
    await expect(app.invoke({ value: "a" })).rejects.toThrow("boom");
    await expect(app.invoke({ value: "b" })).rejects.toThrow("boom");

    // Third call should fail with CircuitBreakerOpenError (circuit is open now)
    await expect(app.invoke({ value: "c" })).rejects.toThrow(CircuitBreakerOpenError);

    // The flaky node should have been called only twice (circuit opened after 2 failures)
    expect(callCount).toBe(2);
  });

  it("circuit breaker with fallback returns fallback value", async () => {
    type S = { value: string };
    let callCount = 0;

    const g = new StateGraph<S>({ channels: { value: lastValue(() => "") } });
    g.addNode("flaky", async () => {
      callCount++;
      throw new Error("boom");
    }, {
      circuitBreaker: {
        threshold: 1,
        resetAfter: 60000,
        fallback: () => ({ value: "fallback-result" }),
      },
    });
    g.addEdge(START, "flaky");
    g.addEdge("flaky", END);
    const app = g.compile();

    // First call fails (trips the breaker)
    await expect(app.invoke({ value: "a" })).rejects.toThrow("boom");

    // Second call uses fallback since circuit is open
    const result = await app.invoke({ value: "b" });
    expect(result.value).toBe("fallback-result");
    expect(callCount).toBe(1); // Only the first call reached the actual node
  });

  it("circuit breaker resets after successful execution in half-open state", async () => {
    type S = { value: string };
    let shouldFail = true;

    const g = new StateGraph<S>({ channels: { value: lastValue(() => "") } });
    g.addNode("flaky", async () => {
      if (shouldFail) throw new Error("boom");
      return { value: "success" };
    }, {
      circuitBreaker: { threshold: 1, resetAfter: 50 },
    });
    g.addEdge(START, "flaky");
    g.addEdge("flaky", END);
    const app = g.compile();

    // Trip the breaker
    await expect(app.invoke({ value: "a" })).rejects.toThrow("boom");

    // Circuit is open — immediate rejection
    await expect(app.invoke({ value: "b" })).rejects.toThrow(CircuitBreakerOpenError);

    // Wait for resetAfter to transition to half-open
    await new Promise((r) => setTimeout(r, 60));

    // Now fix the node and try again (half-open allows one attempt)
    shouldFail = false;
    const result = await app.invoke({ value: "c" });
    expect(result.value).toBe("success");
  });
});
