// ============================================================
// @oni.bot/core/platform - External-agent event taxonomy
// ============================================================
// A stable, versioned mapping from raw ExternalAgentEvent types to platform
// observability semantics. Background-agent fleets correlate provider lifecycle
// events (process start, streaming output, tool calls, termination) to platform
// audit/telemetry; pinning that mapping here prevents observability from
// breaking silently on agent/platform version skew.
// ============================================================

import type { ExternalAgentEventType } from "../harness/external-agent.js";

/**
 * Taxonomy schema version. Bump when an event type's phase/terminal semantics
 * change or a type is added/removed in a way observability consumers must know.
 */
export const EXTERNAL_AGENT_EVENT_TAXONOMY_VERSION = 1;

/** Coarse lifecycle phase a raw external-agent event belongs to. */
export type ExternalAgentLifecyclePhase =
  | "starting"
  | "streaming"
  | "tool"
  | "artifact"
  | "error"
  | "finished";

export interface ExternalAgentEventTaxonomyEntry {
  phase: ExternalAgentLifecyclePhase;
  /** True when the event represents a terminal state for the run. */
  terminal: boolean;
  description: string;
}

export const EXTERNAL_AGENT_EVENT_TAXONOMY: Record<
  ExternalAgentEventType,
  ExternalAgentEventTaxonomyEntry
> = {
  external_agent_start: { phase: "starting", terminal: false, description: "Provider process spawned and the run began." },
  external_agent_stdout: { phase: "streaming", terminal: false, description: "Raw stdout line from the provider process." },
  external_agent_stderr: { phase: "streaming", terminal: false, description: "Raw stderr line from the provider process." },
  external_agent_text_delta: { phase: "streaming", terminal: false, description: "Assistant text output chunk." },
  external_agent_thinking: { phase: "streaming", terminal: false, description: "Provider reasoning/thinking chunk." },
  external_agent_tool_call: { phase: "tool", terminal: false, description: "Provider requested a tool invocation." },
  external_agent_tool_result: { phase: "tool", terminal: false, description: "Result of a provider tool invocation." },
  external_agent_diff: { phase: "artifact", terminal: false, description: "File diff produced by the agent." },
  external_agent_artifact: { phase: "artifact", terminal: false, description: "Non-diff artifact produced by the agent." },
  external_agent_error: { phase: "error", terminal: false, description: "Error event (timeout, idle kill, abort, or provider failure)." },
  external_agent_finish: { phase: "finished", terminal: true, description: "Run finished and produced its final output." },
};

/** Resolve the lifecycle phase for a raw external-agent event type. */
export function externalAgentEventPhase(
  type: ExternalAgentEventType,
): ExternalAgentLifecyclePhase {
  return EXTERNAL_AGENT_EVENT_TAXONOMY[type].phase;
}

/** Whether a raw external-agent event type is a terminal run state. */
export function isTerminalExternalAgentEvent(type: ExternalAgentEventType): boolean {
  return EXTERNAL_AGENT_EVENT_TAXONOMY[type].terminal;
}
