// ============================================================
// @oni.bot/core/swarm — SwarmTracer
// ============================================================
// Structured observability for swarm agent execution.
// Records a timeline of agent lifecycle events (start, complete, error)
// that can be queried, filtered, and cleared.
//
// Usage:
//   const tracer = new SwarmTracer();
//   const agents = tracer.instrument(agentDefs);
//   // ... run swarm ...
//   console.log(tracer.getTimeline());
// ============================================================

import type { AgentLifecycleHooks, SwarmAgentDef } from "./types.js";

// ----------------------------------------------------------------
// Event types
// ----------------------------------------------------------------

export type SwarmEventType = "agent_start" | "agent_complete" | "agent_error";

export interface SwarmEvent {
  type:      SwarmEventType;
  agentId:   string;
  timestamp: number;
  data?:     unknown;
}

// ----------------------------------------------------------------
// SwarmTracer
// ----------------------------------------------------------------

export type SwarmEventListener = (event: SwarmEvent) => void;

const MAX_EVENTS_DEFAULT = 10_000;

export class SwarmTracer {
  private events: SwarmEvent[] = [];
  private listeners: Set<SwarmEventListener> = new Set();
  private readonly maxEvents: number;

  constructor(maxEvents: number = MAX_EVENTS_DEFAULT) {
    this.maxEvents = maxEvents;
  }

  /**
   * Subscribe to live events. The callback fires synchronously on each
   * `record()` call. Returns an unsubscribe function for convenience.
   */
  subscribe(listener: SwarmEventListener): () => void {
    this.listeners.add(listener);
    return () => this.unsubscribe(listener);
  }

  /** Remove a previously registered listener. */
  unsubscribe(listener: SwarmEventListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Generate lifecycle hooks for a specific agent that record events
   * into this tracer's timeline.
   */
  hooksFor(_agentId: string): AgentLifecycleHooks {
    return {
      onStart: (id: string, _state?: Record<string, unknown>) => {
        this.record({ type: "agent_start", agentId: id, timestamp: Date.now() });
      },
      onComplete: (id: string, result: unknown) => {
        this.record({ type: "agent_complete", agentId: id, timestamp: Date.now(), data: result });
      },
      onError: (id: string, error: unknown) => {
        this.record({ type: "agent_error", agentId: id, timestamp: Date.now(), data: error });
      },
    };
  }

  /**
   * Auto-attach tracing hooks to all agents in the array.
   * Returns a new array with hooks set — does not mutate the input.
   */
  instrument<S extends Record<string, unknown>>(
    agents: SwarmAgentDef<S>[],
  ): SwarmAgentDef<S>[] {
    return agents.map((a) => {
      const tracerHooks = this.hooksFor(a.id);
      const existing = a.hooks;
      if (!existing) return { ...a, hooks: tracerHooks };
      // Merge: existing hooks run first, tracer hooks always run after
      return {
        ...a,
        hooks: {
          onStart: async (id, state) => {
            await existing.onStart?.(id, state);
            await tracerHooks.onStart!(id, state);
          },
          onComplete: async (id, result) => {
            await existing.onComplete?.(id, result);
            await tracerHooks.onComplete!(id, result);
          },
          onError: async (id, error) => {
            await existing.onError?.(id, error);
            await tracerHooks.onError!(id, error);
          },
        },
      };
    });
  }

  /** Record a custom event into the timeline. Notifies all live subscribers. */
  record(event: SwarmEvent): void {
    // Atomic reassignment: avoids double-splice under concurrency where
    // a concurrent record() could push onto the old array mid-splice.
    this.events = [...this.events, event].slice(-this.maxEvents);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Subscriber errors must not disrupt recording or other subscribers
      }
    }
  }

  /** Get a copy of the full event timeline. */
  getTimeline(): SwarmEvent[] {
    return [...this.events];
  }

  /** Get events for a specific agent. */
  getAgentEvents(agentId: string): SwarmEvent[] {
    return this.events.filter((e) => e.agentId === agentId);
  }

  /** Compute aggregate metrics from the timeline. */
  metrics(): SwarmMetrics {
    if (this.events.length === 0) {
      return {
        totalDurationMs: 0,
        agentCount: { started: 0, completed: 0, errored: 0 },
        agentLatency: {},
        avgLatencyMs: 0,
        maxLatencyMs: 0,
      };
    }

    let earliest = Infinity;
    let latest = -Infinity;
    let started = 0;
    let completed = 0;
    let errored = 0;

    // Stack-based start times: each agent_start pushes a timestamp so that
    // multiple runs of the same agent are tracked independently.
    const startTimeStacks = new Map<string, number[]>();
    // Accumulate all run latencies per agent to compute true aggregate avg/max.
    const allRunLatencies = new Map<string, number[]>();
    const agentLatency: Record<string, number> = {};

    for (const e of this.events) {
      if (e.timestamp < earliest) earliest = e.timestamp;
      if (e.timestamp > latest) latest = e.timestamp;

      switch (e.type) {
        case "agent_start":
          started++;
          if (!startTimeStacks.has(e.agentId)) startTimeStacks.set(e.agentId, []);
          startTimeStacks.get(e.agentId)!.push(e.timestamp);
          break;
        case "agent_complete": {
          completed++;
          const stack = startTimeStacks.get(e.agentId);
          if (stack && stack.length > 0) {
            const runLatency = e.timestamp - stack.shift()!;
            if (!allRunLatencies.has(e.agentId)) allRunLatencies.set(e.agentId, []);
            allRunLatencies.get(e.agentId)!.push(runLatency);
          }
          break;
        }
        case "agent_error": {
          errored++;
          const stack = startTimeStacks.get(e.agentId);
          if (stack && stack.length > 0) {
            const runLatency = e.timestamp - stack.shift()!;
            if (!allRunLatencies.has(e.agentId)) allRunLatencies.set(e.agentId, []);
            allRunLatencies.get(e.agentId)!.push(runLatency);
          }
          break;
        }
      }
    }

    // Compute per-agent average latency from all runs.
    for (const [agentId, runs] of allRunLatencies.entries()) {
      agentLatency[agentId] = runs.reduce((a, b) => a + b, 0) / runs.length;
    }

    // Flatten all per-agent run latencies for true aggregate avg/max.
    const latencies: number[] = [];
    for (const runs of allRunLatencies.values()) {
      for (const l of runs) latencies.push(l);
    }
    const avgLatencyMs = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;
    const maxLatencyMs = latencies.length > 0
      ? Math.max(...latencies)
      : 0;

    return {
      totalDurationMs: latest - earliest,
      agentCount: { started, completed, errored },
      agentLatency,
      avgLatencyMs,
      maxLatencyMs,
    };
  }

  /** Clear all recorded events. */
  clear(): void {
    this.events.length = 0;
  }
}

// ----------------------------------------------------------------
// SwarmMetrics — computed from SwarmTracer timeline
// ----------------------------------------------------------------

export interface SwarmMetrics {
  /** Total wall-clock duration from first event to last event. */
  totalDurationMs: number;
  /** How many agents started, completed, and errored. */
  agentCount: { started: number; completed: number; errored: number };
  /** Per-agent latency (start → complete/error) in ms. */
  agentLatency: Record<string, number>;
  /** Average latency across all agents that finished. */
  avgLatencyMs: number;
  /** Maximum latency across all agents that finished. */
  maxLatencyMs: number;
}
