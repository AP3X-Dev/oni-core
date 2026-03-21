// ============================================================
// src/pregel/execution.ts — Node execution with retry/timeout/CB
// ============================================================

import {
  type NodeDefinition, type ONIConfig, type CachePolicy, type NodeReturn,
} from "../types.js";
import { ONIError, NodeTimeoutError, NodeExecutionError, CircuitBreakerOpenError } from "../errors.js";
import { CircuitBreaker } from "../circuit-breaker.js";
import { withRetry } from "../retry.js";
import { _runWithContext, type RunContext, type StreamWriter } from "../context.js";
import {
  NodeInterruptSignal, _installInterruptContext,
} from "../hitl/index.js";
import { runFilters } from "../guardrails/filters.js";
import type { AuditEntry } from "../guardrails/types.js";
import type { LifecycleEvent } from "../events/types.js";
import type { PregelContext } from "./types.js";

const DEFAULT_RECURSION_LIMIT = 25;
/** Maximum entries in the node result cache — oldest entries evicted FIFO when full. */
const NODE_CACHE_MAX_SIZE = 256;

export function getCircuitBreaker<S extends Record<string, unknown>>(
  nodeDef: NodeDefinition<S>,
  circuitBreakers: Map<string, CircuitBreaker>,
): CircuitBreaker | null {
  if (!nodeDef.circuitBreaker) return null;
  let cb = circuitBreakers.get(nodeDef.name);
  if (!cb) {
    cb = new CircuitBreaker({
      threshold: nodeDef.circuitBreaker.threshold,
      resetAfter: nodeDef.circuitBreaker.resetAfter,
    }, nodeDef.name);
    circuitBreakers.set(nodeDef.name, cb);
  }
  return cb;
}

export async function executeNode<S extends Record<string, unknown>>(
  ctx: PregelContext<S>,
  nodeDef: NodeDefinition<S>,
  state: S,
  config?: ONIConfig,
  resumeValue?: unknown,
  hasResume?: boolean,
  writer?: StreamWriter | null,
  step?: number,
  recursionLimit?: number,
): Promise<NodeReturn<S>> {
  // Check cache (compute key once, reuse for both lookup and store)
  let cacheKey: string | undefined;
  if (nodeDef.cache) {
    const policy: CachePolicy = typeof nodeDef.cache === "object" ? nodeDef.cache : {};
    const keyFn = policy.key ?? ((s: unknown) => JSON.stringify(s));
    cacheKey = `${nodeDef.name}::${keyFn(state)}`;
    const cached = ctx.nodeCache.get(cacheKey);
    if (cached) {
      const ttl = policy.ttl ?? Infinity;
      if (Date.now() - cached.timestamp < ttl) {
        return cached.result;
      }
      ctx.nodeCache.delete(cacheKey);
    }
  }

  const _tid = config?.threadId ?? "unknown";
  const runCtx: RunContext = {
    config:          config ?? {},
    store:           ctx.store,
    writer:          writer ?? null,
    state:           state,
    parentGraph:     null,
    parentUpdates:   [],
    step:            step ?? 0,
    recursionLimit:  recursionLimit ?? DEFAULT_RECURSION_LIMIT,
    toolPermissions: ctx.toolPermissions,
    _recordUsage: (agentName, modelId, usage) => {
      if (!ctx.budgetTracker) return;
      const entries = ctx.budgetTracker.record(agentName, modelId, usage);
      for (const e of entries) ctx.auditLog?.record(_tid, e);
    },
    _emitEvent: (event) => ctx.eventBus.emit(event as LifecycleEvent),
    _auditRecord: (entry) => ctx.auditLog?.record(_tid, entry as AuditEntry),
  };

  return _runWithContext(runCtx, async () => {
    return _installInterruptContext({
      nodeName:     nodeDef.name,
      resumeValues: hasResume ? [resumeValue] : [],
    }, async () => {
      // Content filter — input direction
      if (ctx.contentFilters.length > 0) {
        const inputStr = JSON.stringify(state);
        const inputCheck = runFilters(ctx.contentFilters, inputStr, "input");
        if (!inputCheck.passed) {
          const threadId = config?.threadId ?? "unknown";
          ctx.eventBus.emit({ type: "filter.blocked", filter: inputCheck.blockedBy!, agent: nodeDef.name, direction: "input", reason: inputCheck.reason!, timestamp: Date.now() });
          ctx.auditLog?.record(threadId, { timestamp: Date.now(), agent: nodeDef.name, action: "filter.blocked", data: { filter: inputCheck.blockedBy, direction: "input", reason: inputCheck.reason } });
          throw new Error(
            `Content blocked by filter "${inputCheck.blockedBy}" on input to node "${nodeDef.name}": ${inputCheck.reason}`,
          );
        }
        // Apply redaction if content was rewritten by a redacting filter
        if (inputCheck.content !== inputStr) {
          const threadId = config?.threadId ?? "unknown";
          ctx.eventBus.emit({ type: "filter.redacted", filter: "pii", agent: nodeDef.name, direction: "input", timestamp: Date.now() });
          ctx.auditLog?.record(threadId, { timestamp: Date.now(), agent: nodeDef.name, action: "filter.redacted", data: { direction: "input" } });
          try { state = JSON.parse(inputCheck.content) as S; } catch { /* leave state unchanged on parse failure */ }
        }
      }

      const run = () => Promise.resolve(nodeDef.fn(state, config));

      // Core execute call: retry-aware
      const executeCall = async (): Promise<NodeReturn<S>> => {
        if (nodeDef.retry) return withRetry(run, nodeDef.name, nodeDef.retry);
        return run();
      };

      // Wrap with timeout if configured (per-node > global default > none)
      const timeoutMs = nodeDef.timeout ?? ctx.defaults?.nodeTimeout;
      const executeWithTimeout = async (): Promise<NodeReturn<S>> => {
        if (timeoutMs != null && timeoutMs > 0) {
          const ac = new AbortController();
          const timer = setTimeout(() => ac.abort(), timeoutMs);
          try {
            const timeoutPromise = new Promise<never>((_, reject) => {
              ac.signal.addEventListener("abort", () => {
                reject(new NodeTimeoutError(nodeDef.name, timeoutMs));
              }, { once: true });
            });
            // Attach a no-op catch so the abort() in `finally` doesn't
            // trigger an unhandled-rejection when executeCall wins the race.
            timeoutPromise.catch(() => {});
            return await Promise.race([executeCall(), timeoutPromise]);
          } finally {
            clearTimeout(timer);
            // Abort to release any remaining signal listeners.  The
            // rejection this triggers is harmless — Promise.race has
            // already settled, so the rejected branch is simply ignored.
            ac.abort();
          }
        }
        return executeCall();
      };

      // Wrap with circuit breaker if configured
      const cb = getCircuitBreaker(nodeDef, ctx.circuitBreakers);
      let result: NodeReturn<S>;
      try {
        if (cb) {
          result = await cb.execute(executeWithTimeout);
        } else {
          result = await executeWithTimeout();
        }
      } catch (err) {
        // Pass through interrupt signals (thrown by interrupt() inside nodes)
        if (err instanceof NodeInterruptSignal) throw err;
        // Circuit breaker open — invoke user fallback with real state + error
        if (err instanceof CircuitBreakerOpenError && nodeDef.circuitBreaker?.fallback) {
          result = nodeDef.circuitBreaker.fallback(state, err) as NodeReturn<S>;
        } else {
          // Pass through structured ONI errors (NodeExecutionError from retry, NodeTimeoutError, etc.)
          if (err instanceof ONIError) throw err;
          // Wrap raw errors and non-Error throws in NodeExecutionError
          const cause = err instanceof Error ? err : new Error(String(err));
          throw new NodeExecutionError(nodeDef.name, cause);
        }
      }

      // Content filter — output direction
      if (ctx.contentFilters.length > 0 && result != null) {
        const outputStr = JSON.stringify(result);
        const outputCheck = runFilters(ctx.contentFilters, outputStr, "output");
        if (!outputCheck.passed) {
          const threadId = config?.threadId ?? "unknown";
          ctx.eventBus.emit({ type: "filter.blocked", filter: outputCheck.blockedBy!, agent: nodeDef.name, direction: "output", reason: outputCheck.reason!, timestamp: Date.now() });
          ctx.auditLog?.record(threadId, { timestamp: Date.now(), agent: nodeDef.name, action: "filter.blocked", data: { filter: outputCheck.blockedBy, direction: "output", reason: outputCheck.reason } });
          throw new Error(
            `Content blocked by filter "${outputCheck.blockedBy}" on output of node "${nodeDef.name}": ${outputCheck.reason}`,
          );
        }
        // Apply redaction if content was rewritten by a redacting filter
        if (outputCheck.content !== outputStr) {
          const threadId = config?.threadId ?? "unknown";
          ctx.eventBus.emit({ type: "filter.redacted", filter: "pii", agent: nodeDef.name, direction: "output", timestamp: Date.now() });
          ctx.auditLog?.record(threadId, { timestamp: Date.now(), agent: nodeDef.name, action: "filter.redacted", data: { direction: "output" } });
          try { result = JSON.parse(outputCheck.content) as NodeReturn<S>; } catch { /* leave result unchanged on parse failure */ }
        }
      }

      // Store in cache (reuse key computed above); evict oldest entry when full
      if (nodeDef.cache && cacheKey) {
        if (ctx.nodeCache.size >= NODE_CACHE_MAX_SIZE) {
          const oldest = ctx.nodeCache.keys().next().value;
          if (oldest !== undefined) ctx.nodeCache.delete(oldest);
        }
        ctx.nodeCache.set(cacheKey, { result, timestamp: Date.now() });
      }

      return result;
    });
  });
}
