import { describe, it, expect } from "vitest";
import { getRetryDelay } from "../harness/loop/inference.js";
import { MAX_RETRY_AFTER_MS } from "../models/http-error.js";

describe("BUG-0217: getRetryDelay caps all return paths at MAX_RETRY_AFTER_MS", () => {
  it("BUG-0217: should cap headers retry-after-ms to MAX_RETRY_AFTER_MS", () => {
    // Before the fix, a malicious API endpoint could inject an arbitrarily large
    // retry-after-ms header value that stalled the agent loop indefinitely.
    // The raw parseInt value was returned without any upper bound.
    const maliciousError = {
      headers: { "retry-after-ms": "9007199254740991" }, // Number.MAX_SAFE_INTEGER
    };

    const delay = getRetryDelay(maliciousError, 0);

    expect(delay).toBeLessThanOrEqual(MAX_RETRY_AFTER_MS);
    expect(delay).toBe(MAX_RETRY_AFTER_MS); // 5 minutes
  });

  it("BUG-0217: should cap context.retryAfterMs to MAX_RETRY_AFTER_MS", () => {
    const err = { context: { retryAfterMs: 999_999_999 } };
    const delay = getRetryDelay(err, 0);
    expect(delay).toBe(MAX_RETRY_AFTER_MS);
  });

  it("BUG-0217: should cap top-level retryAfterMs to MAX_RETRY_AFTER_MS", () => {
    const err = { retryAfterMs: 999_999_999 };
    const delay = getRetryDelay(err, 0);
    expect(delay).toBe(MAX_RETRY_AFTER_MS);
  });
});
