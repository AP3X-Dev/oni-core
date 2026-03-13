// ============================================================
// @oni.bot/core/swarm — DynamicScalingMonitor
// ============================================================
// Reactive scaling decisions based on SwarmTracer events.
// Monitors agent error rates, latencies, and idle periods to
// recommend scale-up or scale-down actions.
//
// Two modes:
// 1. Polling — call evaluate() periodically to get decisions
// 2. Reactive — enableReactive() subscribes to tracer events
//    and fires callback on actionable decisions
// ============================================================

import type { SwarmTracer, SwarmEvent } from "./tracer.js";

// ── Types ──────────────────────────────────────────────────

export interface ScalingConfig {
  /** Minimum number of agents to maintain (default: 1) */
  minAgents?: number;
  /** Maximum number of agents allowed (default: 10) */
  maxAgents?: number;
  /**
   * Error rate threshold to trigger scale-up (0-1, default: 0.25 = 25%).
   * Rationale: 25% catches systemic issues (API degradation, bad prompts)
   * early without over-reacting to transient single-agent failures.
   * Lower than 20% would trigger on 1-of-5 agents failing once.
   */
  scaleUpErrorRate?: number;
  /**
   * Max latency (ms) before triggering scale-up (default: 15000).
   * Rationale: multi-turn LLM agents (think→act→observe cycles) typically
   * take 15-120s per full lifecycle. Opus inference alone is ~10s/call.
   * 5s was far too aggressive — normal Opus agents would constantly trigger.
   */
  scaleUpLatencyMs?: number;
  /**
   * Seconds of no activity before triggering scale-down (default: 60).
   * Rationale: agents actively running may go 30-60s between tracer events
   * (no events emitted mid-execution). 30s caused false scale-downs while
   * agents were still working. 60s gives a full agent lifecycle to complete.
   */
  scaleDownIdleSeconds?: number;
  /**
   * Minimum ms between scaling decisions (default: 10000).
   * Rationale: 10s prevents oscillation in reactive mode where error
   * and complete events fire in rapid succession. 5s was too short when
   * multiple agents complete simultaneously.
   */
  cooldownMs?: number;
}

export interface ScalingDecision {
  /** What action to take */
  action: "scale_up" | "scale_down" | "idle";
  /** Number of agents to add (scale_up) or remove (scale_down) */
  count: number;
  /** Human-readable reason for the decision */
  reason: string;
}

export interface ScalingHistoryEntry {
  decision: ScalingDecision;
  timestamp: number;
}

type ScalingCallback = (decision: ScalingDecision) => void;

// ── Defaults ──────────────────────────────────────────────

const DEFAULT_CONFIG: Required<ScalingConfig> = {
  minAgents: 1,
  maxAgents: 10,
  scaleUpErrorRate: 0.25,
  scaleUpLatencyMs: 15000,
  scaleDownIdleSeconds: 60,
  cooldownMs: 10000,
};

// ── DynamicScalingMonitor ─────────────────────────────────

export class DynamicScalingMonitor {
  private readonly tracer: SwarmTracer;
  private readonly config: Required<ScalingConfig>;
  private currentAgentCount = 0;
  private lastDecision: ScalingDecision | null = null;
  private lastDecisionTime = 0;
  private history: ScalingHistoryEntry[] = [];
  private callbacks: Set<ScalingCallback> = new Set();
  private unsubscribeTracer: (() => void) | null = null;

  constructor(tracer: SwarmTracer, config?: ScalingConfig) {
    this.tracer = tracer;
    this.config = {
      minAgents: config?.minAgents ?? DEFAULT_CONFIG.minAgents,
      maxAgents: config?.maxAgents ?? DEFAULT_CONFIG.maxAgents,
      scaleUpErrorRate: config?.scaleUpErrorRate ?? DEFAULT_CONFIG.scaleUpErrorRate,
      scaleUpLatencyMs: config?.scaleUpLatencyMs ?? DEFAULT_CONFIG.scaleUpLatencyMs,
      scaleDownIdleSeconds: config?.scaleDownIdleSeconds ?? DEFAULT_CONFIG.scaleDownIdleSeconds,
      cooldownMs: config?.cooldownMs ?? DEFAULT_CONFIG.cooldownMs,
    };
  }

  // ── Configuration ─────────────────────────────────────

  getConfig(): Readonly<Required<ScalingConfig>> {
    return this.config;
  }

  setCurrentAgentCount(count: number): void {
    this.currentAgentCount = count;
  }

  getState(): { currentAgentCount: number; lastDecision: ScalingDecision | null } {
    return {
      currentAgentCount: this.currentAgentCount,
      lastDecision: this.lastDecision,
    };
  }

  // ── Core evaluation ───────────────────────────────────

  /**
   * Evaluate current tracer metrics and return a scaling decision.
   * Call this periodically or after significant events.
   */
  evaluate(): ScalingDecision {
    // Check cooldown
    if (this.lastDecisionTime > 0) {
      const elapsed = Date.now() - this.lastDecisionTime;
      if (elapsed < this.config.cooldownMs) {
        return { action: "idle", count: 0, reason: "cooldown active" };
      }
    }

    // No agents to evaluate
    if (this.currentAgentCount === 0) {
      return { action: "idle", count: 0, reason: "no agents registered" };
    }

    const timeline = this.tracer.getTimeline();
    if (timeline.length === 0) {
      return { action: "idle", count: 0, reason: "no events to evaluate" };
    }

    // Single-pass count of starts and errors (used by checkScaleUp)
    let starts = 0;
    let errors = 0;
    for (const e of timeline) {
      if (e.type === "agent_start") starts++;
      else if (e.type === "agent_error") errors++;
    }

    // Check scale-up conditions first (more urgent than scale-down)
    const scaleUp = this.checkScaleUp(starts, errors);
    if (scaleUp) return scaleUp;

    // Check scale-down — last event is most recent (timeline is append-only)
    const lastActivity = timeline[timeline.length - 1]!.timestamp;
    const scaleDown = this.checkScaleDown(lastActivity);
    if (scaleDown) return scaleDown;

    return { action: "idle", count: 0, reason: "metrics within normal range" };
  }

  // ── Scale-up checks ───────────────────────────────────

  private checkScaleUp(starts: number, errors: number): ScalingDecision | null {
    // Already at max
    if (this.currentAgentCount >= this.config.maxAgents) return null;

    // Error rate check
    if (starts > 0) {
      const errorRate = errors / starts;
      if (errorRate >= this.config.scaleUpErrorRate) {
        const headroom = this.config.maxAgents - this.currentAgentCount;
        // Scale by ceil(currentCount * 0.5), capped by headroom
        const addCount = Math.min(
          Math.max(1, Math.ceil(this.currentAgentCount * 0.5)),
          headroom,
        );
        return {
          action: "scale_up",
          count: addCount,
          reason: `error rate ${(errorRate * 100).toFixed(0)}% exceeds ${(this.config.scaleUpErrorRate * 100).toFixed(0)}% threshold`,
        };
      }
    }

    // Latency check
    const metrics = this.tracer.metrics();
    if (metrics.maxLatencyMs > this.config.scaleUpLatencyMs) {
      const headroom = this.config.maxAgents - this.currentAgentCount;
      const addCount = Math.min(
        Math.max(1, Math.ceil(this.currentAgentCount * 0.25)),
        headroom,
      );
      return {
        action: "scale_up",
        count: addCount,
        reason: `max latency ${metrics.maxLatencyMs}ms exceeds ${this.config.scaleUpLatencyMs}ms threshold`,
      };
    }

    return null;
  }

  // ── Scale-down checks ─────────────────────────────────

  private checkScaleDown(lastActivity: number): ScalingDecision | null {
    // Already at minimum
    if (this.currentAgentCount <= this.config.minAgents) return null;

    // Check if all agents have been idle for scaleDownIdleSeconds
    const now = Date.now();
    const idleThresholdMs = this.config.scaleDownIdleSeconds * 1000;

    if (lastActivity > 0 && now - lastActivity > idleThresholdMs) {
      // All agents idle — reduce by half, respecting minAgents
      const removeCount = Math.min(
        Math.max(1, Math.floor(this.currentAgentCount / 2)),
        this.currentAgentCount - this.config.minAgents,
      );
      if (removeCount > 0) {
        return {
          action: "scale_down",
          count: removeCount,
          reason: `all agents idle for ${Math.round((now - lastActivity) / 1000)}s (threshold: ${this.config.scaleDownIdleSeconds}s)`,
        };
      }
    }

    return null;
  }

  // ── Decision recording ────────────────────────────────

  /**
   * Record a decision (for cooldown tracking and history).
   * Call this after applying the decision from evaluate().
   */
  recordDecision(decision: ScalingDecision): void {
    this.lastDecision = decision;
    if (decision.action !== "idle") {
      this.lastDecisionTime = Date.now();
    }
    this.history.push({ decision, timestamp: Date.now() });
  }

  getHistory(): ScalingHistoryEntry[] {
    return [...this.history];
  }

  // ── Reactive mode ─────────────────────────────────────

  /**
   * Register a callback that fires on non-idle scaling decisions.
   */
  onScaleDecision(callback: ScalingCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  /**
   * Enable reactive mode: subscribe to tracer events and auto-evaluate
   * on error events. Non-idle decisions fire registered callbacks.
   */
  enableReactive(): void {
    if (this.unsubscribeTracer) return; // already enabled

    this.unsubscribeTracer = this.tracer.subscribe((event: SwarmEvent) => {
      // Only react to error events (scale-up signal)
      // and complete events (potential scale-down signal)
      if (event.type !== "agent_error" && event.type !== "agent_complete") return;

      const decision = this.evaluate();
      if (decision.action !== "idle") {
        this.recordDecision(decision);
        for (const cb of this.callbacks) {
          try {
            cb(decision);
          } catch {
            // Callback errors must not disrupt monitoring
          }
        }
      }
    });
  }

  /**
   * Disable reactive mode. Stops listening to tracer events.
   */
  disableReactive(): void {
    if (this.unsubscribeTracer) {
      this.unsubscribeTracer();
      this.unsubscribeTracer = null;
    }
  }

  /** Clean up — disables reactive mode. */
  dispose(): void {
    this.disableReactive();
    this.callbacks.clear();
  }
}
