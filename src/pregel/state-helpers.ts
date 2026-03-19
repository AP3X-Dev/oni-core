// ============================================================
// src/pregel/state-helpers.ts — Pure state helper functions
// ============================================================

import {
  Send,
  type NodeName, type Edge, type ChannelSchema,
  type ONIConfig, type ONIStreamEvent, type DynamicInterrupt,
} from "../types.js";
import { ONIInterrupt } from "../errors.js";
import type { PendingSend } from "./types.js";

export function buildInitialState<S extends Record<string, unknown>>(
  channels: ChannelSchema<S>,
): S {
  const state = {} as S;
  for (const key of Object.keys(channels) as (keyof S)[]) {
    state[key] = channels[key].default();
  }
  return state;
}

export function applyUpdate<S extends Record<string, unknown>>(
  channels: ChannelSchema<S>,
  current: S,
  update: Partial<S>,
): S {
  const keys = Object.keys(update) as (keyof S)[];
  if (keys.length === 0) return current;

  // ---- Handoff passthrough (BUG-0267) ----
  // When a node inside a skeleton returns a Handoff object the pregel engine
  // calls applyUpdate with that Handoff as the `update` argument.  All of the
  // Handoff's own keys (isHandoff, opts, to, message, context, …) are absent
  // from the channel schema, so they would be silently skipped and the Handoff
  // would be lost.  Instead, when we detect the update IS a Handoff (duck-
  // typed via the isHandoff marker), we store it verbatim in __pendingHandoff
  // on the returned state so that createAgentNode can retrieve it after
  // skeleton.invoke() returns.  We do not attempt to pass it through a channel
  // reducer — we write directly to the state object so this works regardless
  // of whether the skeleton's channel schema declares __pendingHandoff.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((update as any).isHandoff === true) {
    return { ...current, __pendingHandoff: update } as S;
  }

  const next = { ...current };
  for (const key of keys) {
    if (update[key] !== undefined) {
      const ch = channels[key];
      if (!ch) {
        console.warn(`[oni-core] applyUpdate: unknown channel key "${String(key)}" — skipping (not in channel schema)`);
        continue;
      }
      next[key] = ch.reducer(current[key], update[key] as S[keyof S]);
    }
  }
  return next;
}

export function resetEphemeral<S extends Record<string, unknown>>(
  state: S,
  ephemeralKeys: (keyof S)[],
  channels: ChannelSchema<S>,
): S {
  if (ephemeralKeys.length === 0) return state;
  const next = { ...state };
  for (const key of ephemeralKeys) {
    next[key] = channels[key].default();
  }
  return next;
}

export function getNextNodes<S extends Record<string, unknown>>(
  fromNode: NodeName,
  state: S,
  edgesBySource: Map<string, Edge<S>[]>,
  config?: ONIConfig,
): { nodes: NodeName[]; sends: PendingSend[] } {
  const outgoing = edgesBySource.get(fromNode as string) ?? [];
  const nodes: NodeName[] = [];
  const sends: PendingSend[] = [];

  for (const edge of outgoing) {
    if (edge.type === "static") {
      nodes.push(edge.to);
    } else {
      const result = edge.condition(state, config);
      const resolved = Array.isArray(result) ? result : [result];
      for (const r of resolved) {
        if (r instanceof Send) sends.push({ node: r.node, args: r.args });
        else nodes.push(edge.pathMap?.[r as string] ?? r);
      }
    }
  }
  return { nodes, sends };
}

export function checkDynamicInterrupt<S extends Record<string, unknown>>(
  node: string,
  timing: "before" | "after",
  state: S,
  config?: ONIConfig,
): void {
  const dynamics = config?.dynamicInterrupts as DynamicInterrupt<S>[] | undefined;
  if (!dynamics) return;
  for (const di of dynamics) {
    if (di.node === node && di.timing === timing && di.condition(state)) {
      throw new ONIInterrupt(node, timing, state);
    }
  }
}

export function evt<S extends Record<string, unknown>>(
  event: ONIStreamEvent<S>["event"],
  data: Partial<S> | S,
  step: number,
  agentId?: string,
  node?: string,
): ONIStreamEvent<S> {
  return { event, data, step, timestamp: Date.now(), agentId, node };
}
