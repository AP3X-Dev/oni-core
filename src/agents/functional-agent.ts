// ============================================================
// @oni.bot/core — agent() — Functional Agent Factory
// ============================================================
// Creates an AgentNode from a user-supplied handler function.
//
// Usage:
//   agent("myAgent", async (ctx) => { ... })
//   agent("myAgent", { model, tools }, async (ctx) => { ... })
//
// The handler receives an AgentContext with chat(), stream(),
// executeTools(), coordination methods, and runtime context.
// ============================================================

import type { ONIConfig } from "../types.js";
import type { AgentNode, AgentContext, FunctionalAgentOptions, SwarmMessageView } from "./types.js";
import { buildAgentContext } from "./context.js";

// Try to import runtime context getters — these work inside Pregel
import {
  _getRunContext,
} from "../context.js";

type AgentHandler<S> = (ctx: AgentContext<S>) => Promise<Partial<S>> | Partial<S>;

/**
 * agent() — create a functional agent node
 *
 * Overloads:
 *   agent(name, handler)
 *   agent(name, opts, handler)
 */
export function agent<S extends Record<string, unknown> = Record<string, unknown>>(
  name: string,
  fnOrOpts: AgentHandler<S> | FunctionalAgentOptions,
  fn?: AgentHandler<S>,
): AgentNode<S> {
  let handler: AgentHandler<S>;
  let opts: FunctionalAgentOptions = {};

  if (typeof fnOrOpts === "function") {
    handler = fnOrOpts;
  } else {
    opts = fnOrOpts;
    if (!fn) {
      throw new Error(
        `agent("${name}", opts, fn): handler function is required when passing options.`,
      );
    }
    handler = fn;
  }

  const {
    model,
    tools = [],
    systemPrompt,
    maxSteps = 10,
    maxTokens,
  } = opts;

  const _nodeFn = async (state: S, config?: ONIConfig): Promise<Partial<S>> => {
    // Accumulator for send() calls — merged into state update as swarmMessages
    const pendingMessages: Array<{ to: string; content: unknown; timestamp: number }> = [];

    // Try to get runtime context from AsyncLocalStorage (available inside Pregel)
    const runCtx = _getRunContext();

    const effectiveConfig = config ?? runCtx?.config ?? {};
    const effectiveStore = runCtx?.store ?? null;
    const effectiveWriter = runCtx?.writer ?? null;
    const effectiveRemaining = runCtx
      ? runCtx.recursionLimit - runCtx.step
      : maxSteps;

    const ctx = buildAgentContext<S>({
      model,
      tools,
      agentName: name,
      systemPrompt,
      config: effectiveConfig,
      store: effectiveStore,
      state,
      streamWriter: effectiveWriter,
      remainingSteps: effectiveRemaining,

      onSend: (agent: string, payload: unknown) => {
        pendingMessages.push({
          to: agent,
          content: payload,
          timestamp: Date.now(),
        });
      },

      getInbox: () => {
        // Read swarmMessages from state if available
        const msgs = (state as Record<string, unknown>).swarmMessages;
        if (!Array.isArray(msgs)) return [];
        return msgs.filter(
          (m: SwarmMessageView) => m !== null && typeof m === "object",
        ) as SwarmMessageView[];
      },

      onReply: (msg: SwarmMessageView, payload: unknown) => {
        if (msg._replyChannel) {
          msg._replyChannel(payload);
        }
      },
    });

    // Execute the user handler
    const result = await handler(ctx);

    // Merge pending swarm messages into the result
    if (pendingMessages.length > 0) {
      const existing = Array.isArray((result as Record<string, unknown>).swarmMessages)
        ? (result as Record<string, unknown>).swarmMessages as unknown[]
        : [];
      (result as Record<string, unknown>).swarmMessages = [
        ...existing,
        ...pendingMessages.map((m) => ({
          id: `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          from: name,
          to: m.to,
          content: m.content,
          timestamp: m.timestamp,
        })),
      ];
    }

    return result;
  };

  return {
    name,
    model,
    tools,
    systemPrompt,
    maxSteps,
    maxTokens,
    _nodeFn,
    _isAgent: true,
  };
}
