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

export class SwarmTracer {
  private events: SwarmEvent[] = [];
  private listeners: Set<SwarmEventListener> = new Set();

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
  hooksFor(agentId: string): AgentLifecycleHooks {
    return {
      onStart: (id: string, state?: Record<string, unknown>) => {
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
    return agents.map((a) => ({
      ...a,
      hooks: this.hooksFor(a.id),
    }));
  }

  /** Record a custom event into the timeline. Notifies all live subscribers. */
  record(event: SwarmEvent): void {
    this.events.push(event);
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

    const startTimes = new Map<string, number>();
    const agentLatency: Record<string, number> = {};

    for (const e of this.events) {
      if (e.timestamp < earliest) earliest = e.timestamp;
      if (e.timestamp > latest) latest = e.timestamp;

      switch (e.type) {
        case "agent_start":
          started++;
          startTimes.set(e.agentId, e.timestamp);
          break;
        case "agent_complete":
          completed++;
          if (startTimes.has(e.agentId)) {
            agentLatency[e.agentId] = e.timestamp - startTimes.get(e.agentId)!;
          }
          break;
        case "agent_error":
          errored++;
          if (startTimes.has(e.agentId)) {
            agentLatency[e.agentId] = e.timestamp - startTimes.get(e.agentId)!;
          }
          break;
      }
    }

    const latencies = Object.values(agentLatency);
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
    this.events = [];
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
