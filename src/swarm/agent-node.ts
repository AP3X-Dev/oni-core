// ============================================================
// src/swarm/agent-node.ts — createAgentNode factory
// Extracted from SwarmGraph.addAgent() to keep graph.ts thin.
// ============================================================

import { Command } from "../types.js";
import type { NodeFn, ONIConfig } from "../types.js";
import type { SwarmAgentDef } from "./types.js";
import { Handoff } from "./types.js";
import type { AgentRegistry } from "./registry.js";
import { getInbox } from "./mailbox.js";
import { runWithTimeout } from "../internal/timeout.js";
import type { BaseSwarmState } from "./config.js";

// ----------------------------------------------------------------
// SwarmLiveState — the subset of SwarmGraph fields read at execution time.
// SwarmGraph structurally satisfies this interface (fields are @internal).
// ----------------------------------------------------------------

export interface SwarmLiveState {
  hasSupervisor:      boolean;
  supervisorNodeName: string;
  onErrorPolicy:      "fallback" | "throw";
}

// ----------------------------------------------------------------
// createAgentNode
// ----------------------------------------------------------------

export function createAgentNode<S extends BaseSwarmState>(
  def: SwarmAgentDef<S>,
  registry: AgentRegistry<S>,
  swarmState: SwarmLiveState,
): NodeFn<S> {
  return async (state: S, config?: ONIConfig) => {
    registry.markBusy(def.id);

    // Fire onStart hook — if it throws, mark the agent as errored so it
    // doesn't stay permanently busy (BUG-0037).
    try {
      await def.hooks?.onStart?.(def.id, state as Record<string, unknown>);
    } catch (onStartErr) {
      registry.markError(def.id);
      throw onStartErr;
    }

    const maxRetries = def.maxRetries ?? 2;
    const retryDelayMs = def.retryDelayMs ?? 0;
    let lastError: unknown;
    let lastAttempt = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      lastAttempt = attempt;
      try {
        // Get inbox and filter out already-consumed messages
        const consumedIds = ((state.context as Record<string, unknown>)?.__consumedMsgIds ?? []) as string[];
        const consumedSet = new Set(consumedIds);
        const allInbox = getInbox(state.swarmMessages ?? [], def.id);
        const inbox = allInbox.filter((m) => !consumedSet.has(m.id));

        // Track consumed message IDs
        const newConsumedIds = [...consumedIds, ...inbox.map((m) => m.id)];

        const agentInput: Partial<S> = {
          ...state,
          context: {
            ...(state.context ?? {}),
            inbox,
            __consumedMsgIds: newConsumedIds,
          },
        } as Partial<S>;

        let effectiveTimeout = def.timeout;

        // Clamp agent timeout to remaining deadline (if set)
        const deadlineAbs = (state.context as Record<string, unknown>)?.__deadlineAbsolute as number | undefined;
        if (deadlineAbs != null) {
          const remaining = deadlineAbs - Date.now();
          if (remaining <= 0) {
            throw new Error(`Agent "${def.id}" deadline expired`);
          }
          if (effectiveTimeout == null || remaining < effectiveTimeout) {
            effectiveTimeout = remaining;
          }
        }

        const result = await runWithTimeout(
          () => def.skeleton.invoke(agentInput, {
            ...config,
            agentId: def.id,
          }),
          effectiveTimeout,
          () => new Error(`Agent "${def.id}" timed out after ${effectiveTimeout}ms`),
        );

        // ---- Handoff detection ----
        // The agent's skeleton is a compiled StateGraph. When the agent's node
        // handler returns a Handoff, the pregel engine intercepts it (see
        // applyUpdate in state-helpers.ts) and stores it in
        // result.__pendingHandoff rather than spreading its fields as state
        // updates (which would all be unknown channel keys). We check both the
        // direct case (Handoff returned by a raw NodeFn, not wrapped in a
        // skeleton) and the __pendingHandoff passthrough from the skeleton.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawHandoff = (result instanceof Handoff || (result && (result as any).isHandoff && (result as any).opts))
          ? result
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          : ((result as any)?.__pendingHandoff instanceof Handoff || (result as any)?.__pendingHandoff?.isHandoff)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ? (result as any).__pendingHandoff
            : null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (rawHandoff) { // SAFE: duck-typing unknown agent return value
          const handoff = rawHandoff instanceof Handoff
            ? rawHandoff
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            : new Handoff((rawHandoff as any).opts); // SAFE: duck-typing unknown agent return value
          // Fire onComplete for handoffs too
          await def.hooks?.onComplete?.(def.id, result);
          registry.markIdle(def.id);
          return new Command<S>({
            update: {
              context: { ...(state.context ?? {}), ...(handoff.context ?? {}) },
              handoffHistory: [{
                from:      def.id,
                to:        handoff.to,
                message:   handoff.message,
                step:      state.supervisorRound ?? 0,
                timestamp: Date.now(),
                resume:    handoff.resume,
              }],
              currentAgent: handoff.to,
            } as Partial<S>,
            goto: handoff.to,
          });
        }

        // Fire onComplete hook
        await def.hooks?.onComplete?.(def.id, result);
        registry.markIdle(def.id);

        // ---- Normal result ----
        return {
          ...result,
          context: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...((result as any).context ?? {}), // SAFE: spreading unknown result context field
            __consumedMsgIds: newConsumedIds,
          },
          agentResults: {
            ...(state.agentResults ?? {}),
            [def.id]: result,
          },
          handoffHistory: [
            {
              from:      def.id,
              to:        "__completed__",
              message:   "Agent completed",
              step:      state.supervisorRound ?? 0,
              timestamp: Date.now(),
            },
          ],
        } as Partial<S>;
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          // Backoff delay between retries — clamped to remaining deadline
          if (retryDelayMs > 0) {
            let delay = retryDelayMs;
            const dl = (state.context as Record<string, unknown>)?.__deadlineAbsolute as number | undefined;
            if (dl != null) {
              const remaining = dl - Date.now();
              if (remaining <= 0) break; // deadline expired, stop retrying
              delay = Math.min(delay, remaining);
            }
            await new Promise((r) => setTimeout(r, delay));
          }
          continue; // retry
        }
      }
    }

    // All retries exhausted — mark error once, then fire onError hook
    registry.markError(def.id);
    try {
      await def.hooks?.onError?.(def.id, lastError);
    } catch (hookErr) {
      console.warn(`[oni] onError hook for agent "${def.id}" threw:`, hookErr);
    }

    // Keep agent in error status (don't reset to idle)

    // Build structured error context
    const errStr = String(lastError instanceof Error ? lastError.message : lastError);
    const errType: "model_error" | "tool_error" | "timeout" | "unknown" =
      errStr.includes("timeout") ? "timeout" :
      errStr.includes("model") ? "model_error" :
      errStr.includes("tool") ? "tool_error" :
      "unknown";

    if (swarmState.hasSupervisor && swarmState.onErrorPolicy !== "throw") {
      return new Command<S>({
        update: {
          context: {
            ...(state.context ?? {}),
            lastAgentError: {
              agent: def.id,
              error: errStr,
              type: errType,
              attempt: lastAttempt,
              maxRetries,
            },
          },
        } as unknown as Partial<S>,
        goto: swarmState.supervisorNodeName,
      });
    }

    // No supervisor, or onError: "throw" — rethrow
    throw lastError;
  };
}
