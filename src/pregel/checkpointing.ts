// ============================================================
// src/pregel/checkpointing.ts — Checkpoint persistence helpers
// ============================================================

import type { NodeName, ONICheckpointer, ONICheckpoint } from "../types.js";
import { MemoryCheckpointer } from "../checkpoint.js";
import type { ONITracer } from "../telemetry.js";
import type { PregelContext, PendingSend } from "./types.js";
import { applyUpdate } from "./state-helpers.js";

export async function saveCheckpoint<S extends Record<string, unknown>>(
  ctx: PregelContext<S>,
  threadId: string,
  step: number,
  state: S,
  nextNodes: NodeName[],
  pendingSends: PendingSend[],
  agentId?: string,
  metadata?: Record<string, unknown>,
  pendingWrites?: Array<{ nodeId: string; writes: Record<string, unknown> }>,
): Promise<void> {
  const cp = (ctx._perInvocationCheckpointer.get(threadId) ?? ctx.checkpointer) as typeof ctx.checkpointer;
  if (!cp) return;
  const cpSpan = ctx.tracer.startCheckpointSpan("put", { threadId });
  try {
    await cp.put({
      threadId, step, state, agentId, metadata, pendingWrites,
      nextNodes:    nextNodes.map(String),
      pendingSends: pendingSends,
      timestamp:    Date.now(),
    });
  } finally {
    ctx.tracer.endSpan(cpSpan);
  }
}

export async function getState<S extends Record<string, unknown>>(
  checkpointer: ONICheckpointer<S> | null,
  threadId: string,
): Promise<S | null> {
  if (!checkpointer) return null;
  return (await checkpointer.get(threadId))?.state ?? null;
}

export async function updateState<S extends Record<string, unknown>>(
  checkpointer: ONICheckpointer<S> | null,
  channels: import("../types.js").ChannelSchema<S>,
  threadId: string,
  update: Partial<S>,
): Promise<void> {
  if (!checkpointer) return;
  const cp = await checkpointer.get(threadId);
  if (!cp) return;
  await checkpointer.put({ ...cp, state: applyUpdate(channels, cp.state, update), timestamp: Date.now() });
}

export async function getStateAt<S extends Record<string, unknown>>(
  checkpointer: ONICheckpointer<S> | null,
  threadId: string,
  step: number,
): Promise<S | null> {
  if (!checkpointer) return null;
  const history = await checkpointer.list(threadId);
  return history.find((c) => c.step === step)?.state ?? null;
}

export async function getHistory<S extends Record<string, unknown>>(
  checkpointer: ONICheckpointer<S> | null,
  threadId: string,
): Promise<ONICheckpoint<S>[]> {
  if (!checkpointer) return [];
  return checkpointer.list(threadId);
}

export async function forkFrom<S extends Record<string, unknown>>(
  checkpointer: ONICheckpointer<S> | null,
  threadId: string,
  step: number,
  newThreadId: string,
): Promise<void> {
  if (!checkpointer) return;
  const cp = checkpointer as MemoryCheckpointer<S>;
  if (typeof (cp as MemoryCheckpointer<S>).fork === "function") {
    await (cp as MemoryCheckpointer<S>).fork(threadId, step, newThreadId);
  } else {
    const history = await checkpointer.list(threadId);
    for (const c of history.filter((x) => x.step <= step)) {
      await checkpointer.put({ ...c, threadId: newThreadId });
    }
  }
}
