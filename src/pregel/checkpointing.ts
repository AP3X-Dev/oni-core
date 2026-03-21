// ============================================================
// src/pregel/checkpointing.ts — Checkpoint persistence helpers
// ============================================================

import type { NodeName, ONICheckpointer, ONICheckpoint, ChannelSchema } from "../types.js";
import { MemoryCheckpointer } from "../checkpoint.js";
import type { PregelContext, PendingSend } from "./types.js";
import { applyUpdate } from "./state-helpers.js";

// ---- Per-threadId lock to serialize getState / updateState / forkFrom ----
// Prevents concurrent read-modify-write cycles from clobbering each other.
const _threadLocks = new Map<string, Promise<void>>();

function withThreadLock<T>(threadId: string, fn: () => Promise<T>): Promise<T> {
  const prev = _threadLocks.get(threadId) ?? Promise.resolve();
  // Swallow errors from prev so our fn always runs in sequence
  const tail = prev.then(() => {}, () => {});
  const result = tail.then(fn);
  // Store the void tail so subsequent callers queue behind us
  const voidResult = result.then(() => {}, () => {});
  _threadLocks.set(threadId, voidResult);
  // Clean up when this is still the tail (prevents unbounded map growth)
  voidResult.then(() => {
    if (_threadLocks.get(threadId) === voidResult) _threadLocks.delete(threadId);
  });
  return result;
}

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
  return withThreadLock(threadId, async () =>
    (await checkpointer.get(threadId))?.state ?? null,
  );
}

export async function updateState<S extends Record<string, unknown>>(
  checkpointer: ONICheckpointer<S> | null,
  channels: ChannelSchema<S>,
  threadId: string,
  update: Partial<S>,
): Promise<void> {
  if (!checkpointer) return;
  return withThreadLock(threadId, async () => {
    const cp = await checkpointer.get(threadId);
    if (!cp) return;
    await checkpointer.put({ ...cp, state: applyUpdate(channels, cp.state, update), timestamp: Date.now() });
  });
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
  // Lock on newThreadId so concurrent getState / updateState on that thread
  // cannot observe partially-written fork state (BUG-0453).
  return withThreadLock(newThreadId, async () => {
    const cp = checkpointer as MemoryCheckpointer<S>;
    if (typeof (cp as MemoryCheckpointer<S>).fork === "function") {
      await (cp as MemoryCheckpointer<S>).fork(threadId, step, newThreadId);
    } else {
      // Clear any pre-existing checkpoints for the target thread to prevent
      // a corrupted mixed timeline when newThreadId was previously used.
      await checkpointer.delete(newThreadId);
      const history = await checkpointer.list(threadId);
      for (const c of history.filter((x) => x.step <= step)) {
        await checkpointer.put({ ...c, threadId: newThreadId });
      }
    }
  });
}
