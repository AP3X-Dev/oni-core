/**
 * Shared HTTP error handling for model adapters.
 *
 * Converts HTTP error responses into structured ONI errors:
 * - 429 → ModelRateLimitError (with retry-after header parsing)
 * - 4xx → ModelAPIError (not recoverable)
 * - 5xx → ModelAPIError (recoverable)
 */

import { ModelAPIError, ModelRateLimitError } from "../errors.js";

/**
 * Parse retry-after from response headers.
 * Supports:
 * - `retry-after` (seconds, per HTTP spec)
 * - `retry-after-ms` (milliseconds, used by some providers)
 */
const MAX_RETRY_AFTER_MS = 5 * 60 * 1000; // 5 minutes cap

function buildAuthHint(provider: string, status: number, body: string): string | undefined {
  if (status !== 401) return undefined;

  const providerKey = provider.toLowerCase();
  if (providerKey !== "openrouter") return undefined;

  const lowerBody = body.toLowerCase();
  const looksLikeAuthFailure =
    lowerBody.includes("missing authentication header") ||
    lowerBody.includes("no auth credentials") ||
    lowerBody.includes("invalid api key") ||
    lowerBody.includes("unauthorized");

  if (!looksLikeAuthFailure) return undefined;

  return "Verify OPENROUTER_API_KEY is active/current. If the key is correct, a proxy, VPN, or network appliance may be stripping Authorization headers.";
}

function parseRetryAfterMs(headers: { get(name: string): string | null }): number | undefined {
  // Try millisecond header first (more precise)
  const msHeader = headers.get("retry-after-ms");
  if (msHeader != null) {
    const ms = Number(msHeader);
    if (Number.isFinite(ms) && ms > 0) return Math.min(ms, MAX_RETRY_AFTER_MS);
  }

  // Fall back to standard seconds header
  const secHeader = headers.get("retry-after");
  if (secHeader != null) {
    const sec = Number(secHeader);
    if (Number.isFinite(sec) && sec > 0) return Math.min(sec * 1000, MAX_RETRY_AFTER_MS);
  }

  return undefined;
}

/**
 * Throw a structured error for a non-OK HTTP response.
 * Call this after `const text = await res.text()` on a failed response.
 */
export function throwModelHttpError(
  provider: string,
  status: number,
  body: string,
  headers?: { get(name: string): string | null } | null,
): never {
  if (status === 429) {
    const retryAfterMs = headers ? parseRetryAfterMs(headers) : undefined;
    throw new ModelRateLimitError(provider, retryAfterMs);
  }
  const authHint = buildAuthHint(provider, status, body);
  if (authHint) {
    throw new ModelAPIError(provider, status, body, {
      suggestion: authHint,
      messageBody: `${provider} ${status} error. Hint: ${authHint}`,
    });
  }
  throw new ModelAPIError(provider, status, body);
}
