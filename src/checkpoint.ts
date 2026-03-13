// ============================================================
// @oni.bot/core — Checkpointers v2
// Adds: time-travel, fork, SQLite-ready interface stubs
// ============================================================

import type { ONICheckpoint, ONICheckpointer, CheckpointListOptions } from "./types.js";

// ----------------------------------------------------------------
// MemoryCheckpointer — dev/test, full history retained
// ----------------------------------------------------------------

export class MemoryCheckpointer<S> implements ONICheckpointer<S> {
  private store = new Map<string, ONICheckpoint<S>[]>();

  async get(threadId: string): Promise<ONICheckpoint<S> | null> {
    const history = this.store.get(threadId);
    if (!history?.length) return null;
    return history[history.length - 1] ?? null;
  }

  async put(checkpoint: ONICheckpoint<S>): Promise<void> {
    const existing = this.store.get(checkpoint.threadId) ?? [];
    // Overwrite if same step exists (idempotent)
    const idx = existing.findIndex((c) => c.step === checkpoint.step);
    if (idx >= 0) existing[idx] = { ...checkpoint };
    else existing.push({ ...checkpoint });
    this.store.set(checkpoint.threadId, existing);
  }

  async list(threadId: string, opts?: CheckpointListOptions): Promise<ONICheckpoint<S>[]> {
    let items = [...(this.store.get(threadId) ?? [])];
    if (opts?.before !== undefined) {
      items = items.filter(c => c.step < opts.before!);
    }
    if (opts?.filter) {
      items = items.filter(c => {
        if (!c.metadata) return false;
        return Object.entries(opts.filter!).every(([k, v]) => c.metadata![k] === v);
      });
    }
    if (opts?.limit !== undefined) {
      items = items.slice(0, opts.limit);
    }
    return items;
  }

  async delete(threadId: string): Promise<void> {
    this.store.delete(threadId);
  }

  // ---- Time-travel extensions ----

  async getAt(threadId: string, step: number): Promise<ONICheckpoint<S> | null> {
    const history = this.store.get(threadId) ?? [];
    return history.find((c) => c.step === step) ?? null;
  }

  /** Clone a thread's history up to `step` under a new threadId */
  async fork(
    sourceThreadId: string,
    step: number,
    newThreadId: string
  ): Promise<boolean> {
    const history = this.store.get(sourceThreadId) ?? [];
    const upTo = history.filter((c) => c.step <= step);
    if (!upTo.length) return false;
    this.store.set(
      newThreadId,
      upTo.map((c) => ({ ...c, threadId: newThreadId }))
    );
    return true;
  }

  clear(): void { this.store.clear(); }
}

// ----------------------------------------------------------------
// NoopCheckpointer — stateless default
// ----------------------------------------------------------------

export class NoopCheckpointer<S> implements ONICheckpointer<S> {
  async get(_: string): Promise<null> { return null; }
  async put(_: ONICheckpoint<S>): Promise<void> {}
  async list(_: string): Promise<ONICheckpoint<S>[]> { return []; }
  async delete(_: string): Promise<void> {}
}

// ----------------------------------------------------------------
// Base class for persistent checkpointers (SQLite, Redis, etc.)
// Subclass this and implement the abstract methods.
// ----------------------------------------------------------------

export abstract class PersistentCheckpointer<S> implements ONICheckpointer<S> {
  abstract get(threadId: string):                                       Promise<ONICheckpoint<S> | null>;
  abstract put(checkpoint: ONICheckpoint<S>):                           Promise<void>;
  abstract list(threadId: string, opts?: CheckpointListOptions):        Promise<ONICheckpoint<S>[]>;
  abstract delete(threadId: string):                                    Promise<void>;

  async getAt(threadId: string, step: number): Promise<ONICheckpoint<S> | null> {
    const all = await this.list(threadId);
    return all.find((c) => c.step === step) ?? null;
  }

  async fork(source: string, step: number, dest: string): Promise<boolean> {
    const all = await this.list(source);
    const upTo = all.filter((c) => c.step <= step);
    if (!upTo.length) return false;
    for (const c of upTo) {
      await this.put({ ...c, threadId: dest });
    }
    return true;
  }
}
