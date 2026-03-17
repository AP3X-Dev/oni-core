// ============================================================
// @oni.bot/core/harness/loop — Inference
// LLM invocation with retry/timeout/header-aware backoff.
// ============================================================

import type { ChatResponse, LLMToolDef, ONIModelMessage } from "../../models/types.js";
import type { AgentLoopConfig, LoopMessage } from "../types.js";
import { makeMessage } from "./types.js";

// ─── isRetryableError ───────────────────────────────────────────────────────

/** Check if an error is retryable (rate limits, transient server errors). */
export function isRetryableError(err: unknown): boolean {
  // ONIError (and subclasses like ModelRateLimitError) expose `recoverable`
  if (err && typeof err === "object" && "recoverable" in err) {
    return (err as { recoverable?: boolean }).recoverable !== false;
  }
  // Fallback for third-party errors that may use the `isRetryable` convention
  if (err && typeof err === "object" && "isRetryable" in err) {
    return !!(err as { isRetryable?: boolean }).isRetryable;
  }
  if (err && typeof err === "object") {
    const status = (err as { status?: number }).status;
    if (status === 429 || status === 503 || status === 502 || status === 500) {
      return true;
    }
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("rate limit") || msg.includes("429") || msg.includes("503") || msg.includes("overloaded")) {
      return true;
    }
  }
  return false;
}

// ─── getRetryDelay ──────────────────────────────────────────────────────────

/** Get retry delay with exponential backoff. */
export function getRetryDelay(err: unknown, attempt: number): number {
  if (err && typeof err === "object") {
    // Respect retryAfterMs if provided by the model adapter (e.g. ModelRateLimitError
    // stores it at err.context.retryAfterMs, not as a top-level property).
    const ctx = (err as { context?: Record<string, unknown> }).context;
    if (ctx && typeof ctx.retryAfterMs === "number" && ctx.retryAfterMs > 0) {
      return ctx.retryAfterMs;
    }
    // Also check top-level retryAfterMs for any error that carries it directly
    if ("retryAfterMs" in err) {
      const after = (err as { retryAfterMs?: number }).retryAfterMs;
      if (typeof after === "number" && after > 0) return after;
    }
    // Check headers for retry-after-ms (common in HTTP error responses)
    const headers = (err as { headers?: Record<string, string> }).headers;
    if (headers) {
      const headerMs = headers["retry-after-ms"];
      if (headerMs) {
        const parsed = parseInt(headerMs, 10);
        if (!isNaN(parsed) && parsed > 0) return parsed;
      }
    }
  }
  return Math.min(1000 * Math.pow(2, attempt), 10_000);
}

// ─── runInference ───────────────────────────────────────────────────────────

export interface InferenceResult {
  response: ChatResponse | null;
  /** Yielded messages during retries */
  events: LoopMessage[];
  succeeded: boolean;
  lastError: unknown;
}

/**
 * Run LLM inference with retry/timeout/header-aware backoff.
 * Returns the response and any yield-able events (retry messages).
 */
export async function runInference(
  messages: ONIModelMessage[],
  llmTools: LLMToolDef[],
  systemPrompt: string,
  config: AgentLoopConfig,
  sessionId: string,
  turn: number,
): Promise<InferenceResult> {
  const maxRetries = 3;
  const inferenceTimeoutMs = config.inferenceTimeoutMs ?? 120_000;
  const events: LoopMessage[] = [];

  let response: ChatResponse | null = null;
  let lastInferenceError: unknown = null;
  let succeeded = false;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      let inferenceTimer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        inferenceTimer = setTimeout(
          () => reject(new Error(`Inference timeout after ${inferenceTimeoutMs}ms`)),
          inferenceTimeoutMs,
        );
      });
      try {
        response = await Promise.race([
          config.model.chat({
            messages,
            tools: llmTools.length > 0 ? llmTools : undefined,
            systemPrompt,
            maxTokens: config.maxTokens ?? 8192,
          }),
          timeoutPromise,
        ]);
      } finally {
        clearTimeout(inferenceTimer);
      }
      succeeded = true;
      break;
    } catch (err) {
      lastInferenceError = err;
      const isRetryable = isRetryableError(err);
      if (!isRetryable || attempt >= maxRetries) {
        break;
      }
      // Check abort signal before retrying
      if (config.signal?.aborted) {
        break;
      }
      // Yield inference_retry so the conductor can emit events and update the UI
      const delayMs = getRetryDelay(err, attempt);
      events.push(makeMessage("system", sessionId, turn, {
        subtype: "inference_retry",
        content: `Retrying inference (attempt ${attempt + 1}/${maxRetries}): ${err instanceof Error ? err.message : String(err)}`,
        metadata: {
          attempt: attempt + 1,
          maxRetries,
          delayMs,
          error: err instanceof Error ? err.message : String(err),
        },
      }));
      if (delayMs > 0) {
        // Abort-aware delay: resolve early if signal fires
        await new Promise<void>((resolve) => {
          if (config.signal) {
            const onAbort = () => { clearTimeout(timer); resolve(); };
            if (config.signal.aborted) { resolve(); return; }
            config.signal.addEventListener("abort", onAbort, { once: true });
            const timer = setTimeout(() => {
              config.signal!.removeEventListener("abort", onAbort);
              resolve();
            }, delayMs);
          } else {
            setTimeout(resolve, delayMs);
          }
        });
      }
    }
  }

  return { response, events, succeeded, lastError: lastInferenceError };
}
