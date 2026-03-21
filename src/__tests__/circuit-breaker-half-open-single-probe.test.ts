/**
 * Regression test for BUG-0340:
 * In half_open state, the `_probeInFlight` guard between reading state and
 * setting the flag was not atomic — two concurrent `execute()` calls could
 * both pass the guard and both run the probe function simultaneously,
 * violating the single-probe invariant.
 *
 * Fix: `this._probeInFlight = true` is now set synchronously before any
 * `await`, ensuring the second concurrent caller sees the flag and gets
 * rejected with CircuitBreakerOpenError instead of running a second probe.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { CircuitBreaker } from "../circuit-breaker.js";
import { CircuitBreakerOpenError } from "../errors.js";

afterEach(() => {
  vi.useRealTimers();
});

async function tripThenHalfOpen(
  cb: CircuitBreaker,
  threshold: number,
  resetAfterMs: number,
): Promise<void> {
  const fail = () => Promise.reject(new Error("induced failure"));
  for (let i = 0; i < threshold; i++) {
    await cb.execute(fail).catch(() => {});
  }
  // Advance time so the breaker transitions to half_open on next state read
  vi.useFakeTimers();
  vi.advanceTimersByTime(resetAfterMs + 1);
}

describe("BUG-0340 regression — half_open single-probe invariant", () => {
  it("allows exactly one probe in half_open state under concurrent execution", async () => {
    const resetAfterMs = 500;
    const cb = new CircuitBreaker(
      { threshold: 2, resetAfter: resetAfterMs },
      "testNode",
    );

    await tripThenHalfOpen(cb, 2, resetAfterMs);
    expect(cb.state).toBe("half_open");

    let probeCallCount = 0;

    // Probe completes after a short delay using real async scheduling.
    // Both concurrent callers enter execute() in the same microtask,
    // so without the synchronous flag-set they would both pass the guard.
    const probe = () =>
      new Promise<string>((resolve) => {
        probeCallCount++;
        // Schedule resolution to allow the second execute() call to interleave
        Promise.resolve().then(() => resolve("recovered"));
      });

    vi.useRealTimers();

    // Launch two concurrent execute() calls — only one should run the probe
    const [result1, result2] = await Promise.allSettled([
      cb.execute(probe),
      cb.execute(probe),
    ]);

    // Exactly one probe ran
    expect(probeCallCount).toBe(1);

    // One call succeeded (the probe), the other was rejected as CircuitBreakerOpenError
    const fulfilled = [result1, result2].find((r) => r.status === "fulfilled");
    const rejected = [result1, result2].find((r) => r.status === "rejected");

    expect(fulfilled).toBeDefined();
    expect((fulfilled as PromiseFulfilledResult<string>).value).toBe("recovered");

    expect(rejected).toBeDefined();
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(
      CircuitBreakerOpenError,
    );
  });

  it("second concurrent half_open caller receives fallback when configured", async () => {
    const resetAfterMs = 500;
    const fallbackValue = { isFallback: true };
    const cb = new CircuitBreaker(
      {
        threshold: 1,
        resetAfter: resetAfterMs,
        fallback: () => fallbackValue,
      },
      "fbNode",
    );

    await tripThenHalfOpen(cb, 1, resetAfterMs);
    expect(cb.state).toBe("half_open");

    vi.useRealTimers();

    let probeCallCount = 0;
    const probe = () =>
      new Promise<string>((resolve) => {
        probeCallCount++;
        Promise.resolve().then(() => resolve("ok"));
      });

    // Both callers run concurrently — second should get fallback, not run probe
    const [r1, r2] = await Promise.all([
      cb.execute(probe),
      cb.execute(probe),
    ]);

    // Probe ran exactly once despite two concurrent callers
    expect(probeCallCount).toBe(1);

    // One caller got the real probe result, the other got the fallback
    const values = [r1, r2] as unknown[];
    expect(values).toContain("ok");
    expect(values).toContain(fallbackValue);
  });
});
