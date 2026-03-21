// ============================================================
// @oni.bot/core — Namespaced Checkpointer Wrapper
// ============================================================
// Prefixes threadId with a namespace for checkpoint isolation.
// Used by subgraphs to avoid checkpoint collisions with parent.
// ============================================================

import type { ONICheckpoint, ONICheckpointer, CheckpointListOptions } from "../types.js";

export class NamespacedCheckpointer<S> implements ONICheckpointer<S> {
  constructor(
    private readonly inner: ONICheckpointer<S>,
    private readonly ns: string,
  ) {}

  private prefix(threadId: string): string {
    return `${this.ns}:${threadId}`;
  }

  async get(threadId: string): Promise<ONICheckpoint<S> | null> {
    const cp = await this.inner.get(this.prefix(threadId));
    if (!cp) return null;
    return { ...cp, threadId };
  }

  async put(checkpoint: ONICheckpoint<S>): Promise<void> {
    await this.inner.put({
      ...checkpoint,
      threadId: this.prefix(checkpoint.threadId),
    });
  }

  async list(threadId: string, opts?: CheckpointListOptions): Promise<ONICheckpoint<S>[]> {
    const items = await this.inner.list(this.prefix(threadId), opts);
    return items.map(c => ({ ...c, threadId }));
  }

  async delete(threadId: string): Promise<void> {
    await this.inner.delete(this.prefix(threadId));
  }
}
