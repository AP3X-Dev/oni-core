// ============================================================
// @oni.bot/core/events — SwarmTracer → EventBus Bridge
// ============================================================
// Subscribes to SwarmTracer lifecycle events and re-publishes
// them as typed LifecycleEvent on the EventBus. This enables
// the Conductor to react to swarm agent lifecycle without
// polling the tracer directly.
// ============================================================

import type { SwarmTracer } from "../swarm/tracer.js";
import type { EventBus } from "./bus.js";
import type { SwarmAgentStartedEvent, SwarmAgentCompletedEvent, SwarmAgentFailedEvent } from "./types.js";

/**
 * Bridge SwarmTracer events to an EventBus.
 *
 * Maps:
 * - `agent_start`    → `swarm.agent.started`
 * - `agent_complete`  → `swarm.agent.completed`
 * - `agent_error`     → `swarm.agent.failed`
 *
 * @param tracer  The SwarmTracer to subscribe to
 * @param bus     The EventBus to publish to
 * @param swarmId Identifier for the swarm (included in all events)
 * @returns Unsubscribe function — call to stop the bridge
 */
export function bridgeSwarmTracer(
  tracer: SwarmTracer,
  bus: EventBus,
  swarmId: string,
): () => void {
  const startTimes = new Map<string, number>();

  return tracer.subscribe((event) => {
    switch (event.type) {
      case "agent_start":
        startTimes.set(event.agentId, event.timestamp);
        bus.emit({
          type: "swarm.agent.started",
          swarmId,
          agentName: event.agentId,
          timestamp: event.timestamp,
        } satisfies SwarmAgentStartedEvent);
        break;

      case "agent_complete": {
        const startTime = startTimes.get(event.agentId);
        const durationMs = startTime !== undefined ? event.timestamp - startTime : 0;
        startTimes.delete(event.agentId);
        bus.emit({
          type: "swarm.agent.completed",
          swarmId,
          agentName: event.agentId,
          durationMs,
          timestamp: event.timestamp,
        } satisfies SwarmAgentCompletedEvent);
        break;
      }

      case "agent_error": {
        startTimes.delete(event.agentId);
        const errorMsg = event.data instanceof Error
          ? event.data.message
          : typeof event.data === "string"
            ? event.data
            : "unknown error";
        bus.emit({
          type: "swarm.agent.failed",
          swarmId,
          agentName: event.agentId,
          error: errorMsg,
          timestamp: event.timestamp,
        } satisfies SwarmAgentFailedEvent);
        break;
      }
    }
  });
}
