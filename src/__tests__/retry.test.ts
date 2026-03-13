import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../retry.js";
import { NodeExecutionError } from "../errors.js";

describe("withRetry", () => {
  it("returns on first success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, "node", { maxAttempts: 3 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and succeeds on subsequent attempt", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail-1"))
      .mockResolvedValueOnce("recovered");

    const result = await withRetry(fn, "node", {
      maxAttempts: 3,
      initialDelay: 1,
      jitter: false,
    });
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws NodeExecutionError after exhausting all attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always-fails"));

    try {
      await withRetry(fn, "flaky-node", {
        maxAttempts: 3,
        initialDelay: 1,
        jitter: false,
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(NodeExecutionError);
      const nee = err as NodeExecutionError;
      expect(nee.cause).toBeInstanceOf(Error);
      expect((nee.cause as Error).message).toBe("always-fails");
      expect(fn).toHaveBeenCalledTimes(3);
    }
  });

  it("includes attempts and maxAttempts in error context", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("boom"));

    try {
      await withRetry(fn, "worker", {
        maxAttempts: 4,
        initialDelay: 1,
        jitter: false,
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      const nee = err as NodeExecutionError;
      expect(nee.context.node).toBe("worker");
      expect(nee.context.attempts).toBe(4);
      expect(nee.context.maxAttempts).toBe(4);
    }
  });

  it("stops early when retryOn returns false", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("retryable"))
      .mockRejectedValueOnce(new Error("fatal"));

    try {
      await withRetry(fn, "node", {
        maxAttempts: 5,
        initialDelay: 1,
        jitter: false,
        retryOn: (err) => err.message !== "fatal",
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      const nee = err as NodeExecutionError;
      expect(fn).toHaveBeenCalledTimes(2);
      expect(nee.context.attempts).toBe(2);
      expect((nee.cause as Error).message).toBe("fatal");
    }
  });

  it("applies exponential backoff between retries", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("1"))
      .mockRejectedValueOnce(new Error("2"))
      .mockResolvedValueOnce("ok");

    const start = Date.now();
    await withRetry(fn, "node", {
      maxAttempts: 3,
      initialDelay: 50,
      backoffMultiplier: 2,
      jitter: false,
    });
    const elapsed = Date.now() - start;

    // initialDelay=50 + 50*2=100 = 150ms minimum
    expect(elapsed).toBeGreaterThanOrEqual(100);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("respects maxDelay cap", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("1"))
      .mockRejectedValueOnce(new Error("2"))
      .mockResolvedValueOnce("ok");

    const start = Date.now();
    await withRetry(fn, "node", {
      maxAttempts: 3,
      initialDelay: 100,
      backoffMultiplier: 10,
      maxDelay: 50,
      jitter: false,
    });
    const elapsed = Date.now() - start;

    // Both delays capped at 50ms each = ~100ms max (with some tolerance)
    expect(elapsed).toBeLessThan(300);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("coerces non-Error throws to Error", async () => {
    const fn = vi.fn().mockRejectedValue("string-error");

    try {
      await withRetry(fn, "node", { maxAttempts: 1, initialDelay: 1 });
      expect.unreachable("should have thrown");
    } catch (err) {
      const nee = err as NodeExecutionError;
      expect(nee.cause).toBeInstanceOf(Error);
      expect((nee.cause as Error).message).toBe("string-error");
    }
  });

  it("with maxAttempts=1, does not retry", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("once"));

    try {
      await withRetry(fn, "node", { maxAttempts: 1, initialDelay: 1 });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(fn).toHaveBeenCalledTimes(1);
      const nee = err as NodeExecutionError;
      expect(nee.context.attempts).toBe(1);
      expect(nee.context.maxAttempts).toBe(1);
    }
  });
});
