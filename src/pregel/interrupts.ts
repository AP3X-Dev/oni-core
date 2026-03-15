// ============================================================
// src/pregel/interrupts.ts — HITL interrupt helpers
// ============================================================

import { HITLSessionStore } from "../hitl/index.js";

export function getPendingInterrupts<S extends Record<string, unknown>>(
  hitlStore: HITLSessionStore<S>,
  threadId: string,
) {
  return hitlStore.getByThread(threadId);
}

export function hitlSessionStore<S extends Record<string, unknown>>(
  hitlStore: HITLSessionStore<S>,
): HITLSessionStore<S> {
  return hitlStore;
}
