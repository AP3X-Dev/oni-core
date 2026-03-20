/**
 * Regression test for BUG-0276:
 * CircuitBreaker.execute() must call fallback with (state, error) — matching
 * the execution.ts call site — not with zero arguments. Before the fix,
 * execute() called `this.config.fallback()` with no arguments, while
 * execution.ts called `fallback(state, err)`, making the contract unreliable.
 */

import { describe, it, expect, vi } from "vitest";
import { CircuitBreaker } from "../circuit-breaker.js";
import { CircuitBreakerOpenError } from "../errors.js";

describe("BUG-0276: CircuitBreaker fallback receives (state, error) consistently", () => {
  it("BUG-0276: fallback called by execute() receives (undefined, CircuitBreakerOpenError) when circuit is open", async () => {
    const fallbackArgs: unknown[] = [];
    const fallback = vi.fn((...args: unknown[]) => {
      fallbackArgs.push(...args);
      return { recovered: true };
    });

    const cb = new CircuitBreaker(
      { threshold: 1, resetAfter: 60_000, fallback },
      "test-node",
    );

    // Trip the circuit
    await expect(cb.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow("fail");
    expect(cb.state).toBe("open");

    // Now execute() should invoke fallback
    const result = await cb.execute(() => Promise.resolve("should not run"));
    expect(result).toEqual({ recovered: true });

    expect(fallback).toHaveBeenCalledOnce();

    // First arg should be undefined (no state available inside execute())
    expect(fallbackArgs[0]).toBeUndefined();
    // Second arg should be a CircuitBreakerOpenError
    expect(fallbackArgs[1]).toBeInstanceOf(CircuitBreakerOpenError);
  });

  it("BUG-0276: fallback is called with two args from the open-circuit path when threshold > 1", async () => {
    // Verify fallback contract: execute() must pass (undefined, error) to fallback —
    // the same two-arg signature that execution.ts uses when calling the fallback directly.
    const capturedArgs: unknown[][] = [];
    const fallback = vi.fn((...args: unknown[]) => {
      capturedArgs.push([...args]);
      return { source: "open-path" };
    });

    const cb = new CircuitBreaker(
      { threshold: 2, resetAfter: 60_000, fallback },
      "open-path-node",
    );

    // Trip the circuit by exhausting threshold failures
    for (let i = 0; i < 2; i++) {
      await expect(cb.execute(() => Promise.reject(new Error("trip")))).rejects.toThrow("trip");
    }
    expect(cb.state).toBe("open");

    // Call execute() on the open circuit — should call fallback
    const result = await cb.execute(() => Promise.resolve("unreachable"));
    expect(result).toEqual({ source: "open-path" });

    expect(fallback).toHaveBeenCalledOnce();
    // Fallback must receive exactly two args: (undefined, CircuitBreakerOpenError)
    expect(capturedArgs[0]).toHaveLength(2);
    expect(capturedArgs[0]![0]).toBeUndefined();
    expect(capturedArgs[0]![1]).toBeInstanceOf(CircuitBreakerOpenError);
  });

  it("BUG-0276: fallback return value is propagated correctly to callers", async () => {
    const expected = { status: "degraded", value: 42 };
    const fallback = vi.fn(() => expected);

    const cb = new CircuitBreaker(
      { threshold: 2, resetAfter: 60_000, fallback },
      "val-node",
    );

    // Trip the circuit
    for (let i = 0; i < 2; i++) {
      await expect(cb.execute(() => Promise.reject(new Error("e")))).rejects.toThrow("e");
    }

    const result = await cb.execute(() => Promise.resolve(null));
    expect(result).toBe(expected);
  });
});
