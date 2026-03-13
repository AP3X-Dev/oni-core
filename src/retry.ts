// ============================================================
// @oni.bot/core — Retry Engine
// ============================================================

import type { RetryPolicy } from "./types.js";
import { NodeExecutionError, ONIError } from "./errors.js";

const DEFAULT_POLICY: Required<Omit<RetryPolicy, "retryOn">> = {
  maxAttempts:       3,
  initialDelay:      500,
  backoffMultiplier: 2,
  maxDelay:          30_000,
  jitter:            true,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  nodeName: string,
  policy: RetryPolicy
): Promise<T> {
  const maxAttempts       = policy.maxAttempts;
  const initialDelay      = policy.initialDelay      ?? DEFAULT_POLICY.initialDelay;
  const backoffMultiplier = policy.backoffMultiplier  ?? DEFAULT_POLICY.backoffMultiplier;
  const maxDelay          = policy.maxDelay           ?? DEFAULT_POLICY.maxDelay;
  // Default retryOn: skip non-recoverable ONIErrors, retry everything else
  const retryOn = policy.retryOn ?? ((err: Error) => {
    if (err instanceof ONIError && err.recoverable === false) return false;
    return true;
  });

  let lastError: Error | undefined;
  let delay = initialDelay;
  let actualAttempts = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    actualAttempts = attempt;
    try {
      return await fn();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error;

      const isLast = attempt === maxAttempts;
      const shouldRetry = retryOn(error);

      if (isLast || !shouldRetry) break;

      // Add ±25% jitter to prevent thundering herd
      const jitterEnabled = policy.jitter !== false; // default true
      if (jitterEnabled) {
        delay = Math.round(delay * (0.75 + Math.random() * 0.5));
      }

      await sleep(delay);
      delay = Math.min(delay * backoffMultiplier, maxDelay);
    }
  }

  throw new NodeExecutionError(nodeName, lastError!, { attempts: actualAttempts, maxAttempts });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
