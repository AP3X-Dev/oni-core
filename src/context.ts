// ============================================================
// @oni.bot/core — Runtime Context (AsyncLocalStorage)
// ============================================================
// Provides getConfig(), getStore(), getStreamWriter() as
// free-standing imports callable from inside any node.
// ============================================================

import { AsyncLocalStorage } from "node:async_hooks";
import type { ONIConfig } from "./types.js";
import type { BaseStore } from "./store/index.js";

// Forward-declare StreamWriter interface — avoids circular dep with streaming.ts
export interface StreamWriter {
  emit(name: string, data: unknown): void;
  token(token: string): void;
}

export interface RunContext {
  config: ONIConfig;
  store: BaseStore | null;
  writer: StreamWriter | null;
  state: unknown;
  parentGraph: unknown | null;
  parentUpdates: Array<Partial<unknown>>;
  step: number;
  recursionLimit: number;
}

const storage = new AsyncLocalStorage<RunContext>();

// ---- Internal: run a function with context installed ----

export function _runWithContext<T>(
  ctx: RunContext,
  fn: () => T | Promise<T>,
): Promise<T> {
  return storage.run(ctx, () => Promise.resolve(fn()));
}

export function _getRunContext(): RunContext | undefined {
  return storage.getStore();
}

// ---- Public accessors ----

export function getConfig(): ONIConfig {
  const ctx = storage.getStore();
  if (!ctx) throw new Error("getConfig() called outside of a graph node execution.");
  return ctx.config;
}

export function getStore(): BaseStore | null {
  const ctx = storage.getStore();
  if (!ctx) throw new Error("getStore() called outside of a graph node execution.");
  return ctx.store;
}

export function getStreamWriter(): StreamWriter | null {
  const ctx = storage.getStore();
  if (!ctx) throw new Error("getStreamWriter() called outside of a graph node execution.");
  return ctx.writer;
}

export function getCurrentState<S>(): S {
  const ctx = storage.getStore();
  if (!ctx) throw new Error("getCurrentState() called outside of a graph node execution.");
  return ctx.state as S;
}

export function getRemainingSteps(): number {
  const ctx = storage.getStore();
  if (!ctx) throw new Error("getRemainingSteps() called outside of a graph node execution.");
  return ctx.recursionLimit - ctx.step;
}
