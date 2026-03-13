import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../retry.js";
import { ModelAPIError, ModelRateLimitError, ONIError, NodeTimeoutError } from "../errors.js";

/* ------------------------------------------------------------------ */
/*  retryOn default: ONIError.recoverable awareness                    */
/* ------------------------------------------------------------------ */

describe("withRetry — recoverable-aware default", () => {
  // ── Non-recoverable ONIErrors should NOT be retried ─────────────

  it("does not retry ModelAPIError with 400 (non-recoverable)", async () => {
    const fn = vi.fn().mockRejectedValue(new ModelAPIError("openai", 400, "Bad Request"));

    await expect(
      withRetry(fn, "test-node", { maxAttempts: 3 })
    ).rejects.toThrow(/test-node/);

    expect(fn).toHaveBeenCalledTimes(1); // no retries
  });

  it("does not retry ModelAPIError with 401 (non-recoverable)", async () => {
    const fn = vi.fn().mockRejectedValue(new ModelAPIError("anthropic", 401, "Invalid key"));

    await expect(
      withRetry(fn, "auth-node", { maxAttempts: 3 })
    ).rejects.toThrow(/auth-node/);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry ModelAPIError with 403 (non-recoverable)", async () => {
    const fn = vi.fn().mockRejectedValue(new ModelAPIError("google", 403, "Forbidden"));

    await expect(
      withRetry(fn, "forbidden-node", { maxAttempts: 3 })
    ).rejects.toThrow(/forbidden-node/);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  // ── Recoverable ONIErrors SHOULD be retried ─────────────────────

  it("retries ModelAPIError with 500 (recoverable)", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new ModelAPIError("openai", 500, "Internal Server Error"))
      .mockRejectedValueOnce(new ModelAPIError("openai", 502, "Bad Gateway"))
      .mockResolvedValueOnce("success");

    const result = await withRetry(fn, "server-node", {
      maxAttempts: 3,
      initialDelay: 1,
      jitter: false,
    });

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("retries ModelRateLimitError (recoverable)", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new ModelRateLimitError("openai"))
      .mockResolvedValueOnce("ok");

    const result = await withRetry(fn, "rate-node", {
      maxAttempts: 3,
      initialDelay: 1,
      jitter: false,
    });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries NodeTimeoutError (recoverable)", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new NodeTimeoutError("slow", 5000))
      .mockResolvedValueOnce("done");

    const result = await withRetry(fn, "timeout-node", {
      maxAttempts: 3,
      initialDelay: 1,
      jitter: false,
    });

    expect(result).toBe("done");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // ── Plain Error (non-ONI) should still be retried ───────────────

  it("retries plain Error (unknown recoverability defaults to retry)", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("network issue"))
      .mockResolvedValueOnce("recovered");

    const result = await withRetry(fn, "plain-node", {
      maxAttempts: 3,
      initialDelay: 1,
      jitter: false,
    });

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // ── Custom retryOn still overrides default ──────────────────────

  it("custom retryOn overrides the default recoverable check", async () => {
    const fn = vi.fn().mockRejectedValue(new ModelAPIError("openai", 500, "Server Error"));

    // Custom retryOn that says never retry
    await expect(
      withRetry(fn, "custom-node", {
        maxAttempts: 3,
        retryOn: () => false,
      })
    ).rejects.toThrow(/custom-node/);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  // ── ONIError with recoverable: false (generic) ─────────────────

  it("does not retry generic ONIError with recoverable: false", async () => {
    const err = new ONIError("Something permanent", {
      code: "ONI_GRAPH_INVALID",
      category: "GRAPH",
      recoverable: false,
    });
    const fn = vi.fn().mockRejectedValue(err);

    await expect(
      withRetry(fn, "perm-node", { maxAttempts: 3 })
    ).rejects.toThrow(/perm-node/);

    expect(fn).toHaveBeenCalledTimes(1);
  });
});
