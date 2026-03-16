// ============================================================
// @oni.bot/core/swarm — AgentPool
// ============================================================
// Manages N instances of equivalent agents with load balancing.
// Provides a unified invoke() that routes to the least-busy
// agent or queues if all are at capacity.
// ============================================================

import type { SwarmAgentDef } from "./types.js";
import type { ONIConfig } from "../types.js";
import { runWithTimeout } from "../internal/timeout.js";

interface PoolSlot<S extends Record<string, unknown>> {
  agent:       SwarmAgentDef<S>;
  activeTasks: number;
  totalRuns:   number;
}

type PoolStrategy = "round-robin" | "least-busy" | "random";

export class AgentPool<S extends Record<string, unknown>> {
  private slots:    PoolSlot<S>[];
  private strategy: PoolStrategy;
  private rrIndex = 0;
  private static readonly PRIORITY_ORDER: Record<string, number> = {
    critical: 0, high: 1, normal: 2, low: 3,
  };

  private queue: Array<{
    input:    Partial<S>;
    config?:  ONIConfig;
    priority: string;
    resolve:  (value: S) => void;
    reject:   (reason: unknown) => void;
  }> = [];
  private maxQueueDepth: number;

  constructor(
    agents:    SwarmAgentDef<S>[],
    opts?: { strategy?: PoolStrategy; maxQueueDepth?: number }
  ) {
    if (!agents.length) throw new Error("AgentPool requires at least one agent.");
    this.slots         = agents.map((a) => ({ agent: a, activeTasks: 0, totalRuns: 0 }));
    this.strategy      = opts?.strategy ?? "least-busy";
    this.maxQueueDepth = opts?.maxQueueDepth ?? 100;
  }

  // ---- Public API ----

  async invoke(input: Partial<S>, config?: ONIConfig, priority?: string): Promise<S> {
    const slot = this.pickSlot();

    if (slot) {
      return this.runOnSlot(slot, input, config);
    }

    // All at capacity — queue with backpressure
    if (this.queue.length >= this.maxQueueDepth) {
      throw new Error(`AgentPool queue depth exceeded (max ${this.maxQueueDepth}). Apply backpressure.`);
    }

    return new Promise<S>((resolve, reject) => {
      this.queue.push({ input, config, priority: priority ?? "normal", resolve, reject });
      // Re-sort queue by priority
      this.queue.sort((a, b) =>
        (AgentPool.PRIORITY_ORDER[a.priority] ?? 2) - (AgentPool.PRIORITY_ORDER[b.priority] ?? 2),
      );
    });
  }

  /** Run N inputs across the pool in parallel */
  async batch(inputs: Partial<S>[], config?: ONIConfig): Promise<S[]> {
    return Promise.all(inputs.map((inp) => this.invoke(inp, config)));
  }

  /** Run N inputs and return settled results (never rejects) */
  async batchSettled(inputs: Partial<S>[], config?: ONIConfig): Promise<PromiseSettledResult<S>[]> {
    return Promise.allSettled(inputs.map((inp) => this.invoke(inp, config)));
  }

  // ---- Stats ----

  stats(): Array<{ agentId: string; activeTasks: number; totalRuns: number }> {
    return this.slots.map((s) => ({
      agentId:     s.agent.id,
      activeTasks: s.activeTasks,
      totalRuns:   s.totalRuns,
    }));
  }

  queueDepth(): number { return this.queue.length; }

  slotCount(): number { return this.slots.length; }

  /** Add new agent slots to the pool at runtime. */
  addSlots(agents: SwarmAgentDef<S>[]): void {
    for (const a of agents) {
      if (this.slots.some((s) => s.agent.id === a.id)) {
        throw new Error(`Cannot add duplicate agent ID "${a.id}" to pool.`);
      }
    }
    for (const a of agents) {
      this.slots.push({ agent: a, activeTasks: 0, totalRuns: 0 });
    }
    // Drain queued requests onto newly available slots so callers are not
    // blocked waiting for an in-flight task to finish when idle capacity
    // already exists.
    while (this.queue.length > 0) {
      const slot = this.pickSlot();
      if (!slot) break;
      const next = this.queue.shift()!;
      Promise.resolve()
        .then(() => this.runOnSlot(slot, next.input, next.config))
        .then(next.resolve, next.reject);
    }
  }

  /** Remove agent slots by ID. Cannot remove the last agent. */
  removeSlots(agentIds: string[]): void {
    const toRemove = new Set(agentIds);
    const remaining = this.slots.filter((s) => !toRemove.has(s.agent.id));
    if (remaining.length === 0 && this.slots.length > 0) {
      throw new Error("AgentPool must retain at least one agent.");
    }
    this.slots = remaining;
  }

  // ---- Internals ----

  private pickSlot(): PoolSlot<S> | null {
    const available = this.slots.filter(
      (s) => s.activeTasks < (s.agent.maxConcurrency ?? 1)
    );
    if (!available.length) return null;

    switch (this.strategy) {
      case "least-busy":
        return available.reduce((a, b) => (a.activeTasks <= b.activeTasks ? a : b));
      case "round-robin": {
        const total = this.slots.length;
        for (let i = 0; i < total; i++) {
          const idx = (this.rrIndex + i) % total;
          const candidate = this.slots[idx]!;
          if (candidate.activeTasks < (candidate.agent.maxConcurrency ?? 1)) {
            this.rrIndex = idx + 1;
            return candidate;
          }
        }
        return null;
      }
      case "random":
        return available[Math.floor(Math.random() * available.length)]!;
    }
  }

  private async runOnSlot(
    slot:    PoolSlot<S>,
    input:   Partial<S>,
    config?: ONIConfig
  ): Promise<S> {
    slot.activeTasks++;
    slot.totalRuns++;

    const agent = slot.agent;
    const maxRetries = agent.maxRetries ?? 0;
    const timeout = agent.timeout;
    const retryDelayMs = agent.retryDelayMs;

    try {
      // Fire onStart hook
      await agent.hooks?.onStart?.(agent.id, input as Record<string, unknown>);

      let lastError: unknown;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const result = await runWithTimeout(
            () => agent.skeleton.invoke(input, { ...config, agentId: agent.id }),
            timeout,
            () => new Error(`Agent "${agent.id}" timed out after ${timeout}ms`),
          );

          // Fire onComplete hook
          await agent.hooks?.onComplete?.(agent.id, result);

          return result;
        } catch (err) {
          lastError = err;
          if (attempt < maxRetries) {
            if (retryDelayMs && retryDelayMs > 0) {
              await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
            }
            continue;
          }
        }
      }

      // All retries exhausted — fire onError hook
      await agent.hooks?.onError?.(agent.id, lastError);

      throw lastError;
    } finally {
      slot.activeTasks--;
      if (this.queue.length > 0) {
        const next = this.queue.shift()!;
        if (this.slots.includes(slot)) {
          // Slot still active — drain directly for efficiency
          Promise.resolve()
            .then(() => this.runOnSlot(slot, next.input, next.config))
            .then(next.resolve, next.reject);
        } else {
          // Slot was removed — route through normal dispatch so removed agents
          // never execute queued work
          this.invoke(next.input, next.config, next.priority)
            .then(next.resolve, next.reject);
        }
      }
    }
  }
}
