import { describe, it, expect, vi, beforeEach } from "vitest";
import { CircuitBreaker } from "../circuit-breaker.js";
import type { CircuitBreakerConfig } from "../circuit-breaker.js";
import { CircuitBreakerOpenError } from "../errors.js";

describe("CircuitBreaker", () => {
  let cb: CircuitBreaker;
  const defaultConfig: CircuitBreakerConfig = {
    threshold: 3,
    resetAfter: 1000,
  };

  beforeEach(() => {
    cb = new CircuitBreaker(defaultConfig, "testNode");
  });

  // ── 1. Starts in CLOSED state ──────────────────────────────

  it("starts in CLOSED state", () => {
    expect(cb.state).toBe("closed");
  });

  // ── 2. Stays CLOSED on success ─────────────────────────────

  it("stays CLOSED on success", async () => {
    const result = await cb.execute(() => Promise.resolve("ok"));
    expect(result).toBe("ok");
    expect(cb.state).toBe("closed");
  });

  // ── 3. Transitions to OPEN after threshold failures ────────

  it("transitions to OPEN after threshold consecutive failures", async () => {
    const fail = () => Promise.reject(new Error("fail"));

    for (let i = 0; i < defaultConfig.threshold; i++) {
      await expect(cb.execute(fail)).rejects.toThrow("fail");
    }

    expect(cb.state).toBe("open");
  });

  it("does not open before reaching threshold", async () => {
    const fail = () => Promise.reject(new Error("fail"));

    for (let i = 0; i < defaultConfig.threshold - 1; i++) {
      await expect(cb.execute(fail)).rejects.toThrow("fail");
    }

    expect(cb.state).toBe("closed");
  });

  // ── 4. Throws CircuitBreakerOpenError when OPEN ────────────

  it("throws CircuitBreakerOpenError when OPEN", async () => {
    const fail = () => Promise.reject(new Error("fail"));

    // trip the breaker
    for (let i = 0; i < defaultConfig.threshold; i++) {
      await expect(cb.execute(fail)).rejects.toThrow("fail");
    }
    expect(cb.state).toBe("open");

    // now it should throw CircuitBreakerOpenError without calling fn
    const fn = vi.fn(() => Promise.resolve("ok"));
    await expect(cb.execute(fn)).rejects.toThrow(CircuitBreakerOpenError);
    expect(fn).not.toHaveBeenCalled();
  });

  // ── 5. Transitions to HALF_OPEN after resetAfter period ────

  it("transitions to HALF_OPEN after resetAfter period", async () => {
    const fail = () => Promise.reject(new Error("fail"));

    // trip the breaker
    for (let i = 0; i < defaultConfig.threshold; i++) {
      await expect(cb.execute(fail)).rejects.toThrow("fail");
    }
    expect(cb.state).toBe("open");

    // advance time past resetAfter
    vi.useFakeTimers();
    vi.advanceTimersByTime(defaultConfig.resetAfter + 1);

    expect(cb.state).toBe("half_open");

    vi.useRealTimers();
  });

  // ── 6. HALF_OPEN → CLOSED on success ──────────────────────

  it("transitions from HALF_OPEN to CLOSED on success", async () => {
    const fail = () => Promise.reject(new Error("fail"));

    // trip the breaker
    for (let i = 0; i < defaultConfig.threshold; i++) {
      await expect(cb.execute(fail)).rejects.toThrow("fail");
    }
    expect(cb.state).toBe("open");

    // advance time to trigger half_open
    vi.useFakeTimers();
    vi.advanceTimersByTime(defaultConfig.resetAfter + 1);
    expect(cb.state).toBe("half_open");

    // successful call should close it
    const result = await cb.execute(() => Promise.resolve("recovered"));
    expect(result).toBe("recovered");
    expect(cb.state).toBe("closed");

    vi.useRealTimers();
  });

  // ── 7. HALF_OPEN → OPEN on failure ────────────────────────

  it("transitions from HALF_OPEN to OPEN on failure", async () => {
    const fail = () => Promise.reject(new Error("fail"));

    // trip the breaker
    for (let i = 0; i < defaultConfig.threshold; i++) {
      await expect(cb.execute(fail)).rejects.toThrow("fail");
    }
    expect(cb.state).toBe("open");

    // advance time to trigger half_open
    vi.useFakeTimers();
    vi.advanceTimersByTime(defaultConfig.resetAfter + 1);
    expect(cb.state).toBe("half_open");

    // failure in half_open should re-open immediately
    await expect(cb.execute(fail)).rejects.toThrow("fail");
    expect(cb.state).toBe("open");

    vi.useRealTimers();
  });

  // ── 8. Calls fallback when OPEN (if configured) ───────────

  it("calls fallback when OPEN if configured", async () => {
    const fallbackResult = { fallback: true };
    const cbWithFallback = new CircuitBreaker(
      { ...defaultConfig, fallback: () => fallbackResult },
      "fbNode",
    );
    const fail = () => Promise.reject(new Error("fail"));

    // trip the breaker
    for (let i = 0; i < defaultConfig.threshold; i++) {
      await expect(cbWithFallback.execute(fail)).rejects.toThrow("fail");
    }
    expect(cbWithFallback.state).toBe("open");

    // should return fallback instead of throwing
    const result = await cbWithFallback.execute(() => Promise.resolve("ignored"));
    expect(result).toEqual(fallbackResult);
  });

  // ── 9. Resets consecutive failure count on success ─────────

  it("resets consecutive failure count on success", async () => {
    const fail = () => Promise.reject(new Error("fail"));
    const succeed = () => Promise.resolve("ok");

    // fail threshold-1 times (just under the limit)
    for (let i = 0; i < defaultConfig.threshold - 1; i++) {
      await expect(cb.execute(fail)).rejects.toThrow("fail");
    }
    expect(cb.state).toBe("closed");

    // one success resets the counter
    await cb.execute(succeed);
    expect(cb.state).toBe("closed");

    // now fail threshold-1 times again — should still be closed
    for (let i = 0; i < defaultConfig.threshold - 1; i++) {
      await expect(cb.execute(fail)).rejects.toThrow("fail");
    }
    expect(cb.state).toBe("closed");
  });

  // ── Additional edge cases ─────────────────────────────────

  it("reset() restores to initial CLOSED state", async () => {
    const fail = () => Promise.reject(new Error("fail"));

    // trip the breaker
    for (let i = 0; i < defaultConfig.threshold; i++) {
      await expect(cb.execute(fail)).rejects.toThrow("fail");
    }
    expect(cb.state).toBe("open");

    cb.reset();
    expect(cb.state).toBe("closed");

    // should work normally after reset
    const result = await cb.execute(() => Promise.resolve("after reset"));
    expect(result).toBe("after reset");
  });

  it("uses 'unknown' as default node name", async () => {
    const unnamed = new CircuitBreaker({ threshold: 1, resetAfter: 100 });
    const fail = () => Promise.reject(new Error("fail"));

    await expect(unnamed.execute(fail)).rejects.toThrow("fail");
    expect(unnamed.state).toBe("open");

    try {
      await unnamed.execute(() => Promise.resolve("x"));
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitBreakerOpenError);
      expect((err as CircuitBreakerOpenError).message).toContain("unknown");
    }
  });
});
