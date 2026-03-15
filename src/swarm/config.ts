// ============================================================
// src/swarm/config.ts — SwarmGraph topology config types
// Extracted from graph.ts to keep SwarmGraph class focused.
// ============================================================

import { END, appendList, lastValue, mergeObject } from "../types.js";
import type { ChannelSchema, NodeDefinition, Edge, ONICheckpointer } from "../types.js";
import type { BaseStore } from "../store/index.js";
import type { GuardrailsConfig } from "../guardrails/types.js";
import type { EventListeners } from "../events/types.js";
import type { TracerLike } from "../telemetry.js";
import type { ONIModel } from "../models/types.js";
import type { SwarmAgentDef, HandoffRecord, SwarmMessage } from "./types.js";
import type { AgentRegistry } from "./registry.js";

// ----------------------------------------------------------------
// PregelRunnerInternals — typed access to private ONIPregelRunner fields
// used by spawnAgent/removeAgent/toMermaid after compile().
// ----------------------------------------------------------------

export interface PregelRunnerInternals<S extends Record<string, unknown>> {
  nodes: Map<string, NodeDefinition<S>>;
  _edgesBySource: Map<string, Edge<S>[]>;
}

// ----------------------------------------------------------------
// Default swarm state channels
// ----------------------------------------------------------------

export type BaseSwarmState = {
  task:            string;
  context:         Record<string, unknown>;
  agentResults:    Record<string, unknown>;
  messages:        Array<{ role: string; content: string }>;
  swarmMessages:   SwarmMessage[];
  supervisorRound: number;
  currentAgent:    string | null;
  done:            boolean;
  handoffHistory:  HandoffRecord[];
  [key: string]:   unknown;
};

export const baseSwarmChannels = {
  task:            lastValue(() => ""),
  context:         mergeObject(() => ({})),
  agentResults:    mergeObject(() => ({})),
  messages:        appendList(() => [] as Array<{ role: string; content: string }>),
  swarmMessages:   appendList(() => [] as SwarmMessage[]),
  supervisorRound: lastValue(() => 0),
  currentAgent:    lastValue((): string | null => null),
  done:            lastValue(() => false),
  handoffHistory:  appendList(() => [] as HandoffRecord[]),
};

// ----------------------------------------------------------------
// HierarchicalConfig — config object for the hierarchical template
// ----------------------------------------------------------------

export interface HierarchicalConfig<S extends BaseSwarmState> {
  supervisor: {
    model?: ONIModel;
    strategy: "llm" | "rule" | "round-robin";
    rules?: Array<{ condition: (task: string, context: Record<string, unknown>) => boolean; agentId: string }>;
    systemPrompt?: string;
    maxRounds?: number;
    /** Whole-swarm deadline in ms, computed from invoke-time (not compile-time). */
    deadlineMs?: number;
    /** Auto-recover: when an agent errors, route to an idle agent with matching capability. */
    autoRecover?: boolean;
  };
  agents: SwarmAgentDef<S>[];
  channels?: Partial<ChannelSchema<S>>;
  onError?: "fallback" | "throw";
}

// ----------------------------------------------------------------
// FanOutConfig — config object for the fan-out template
// ----------------------------------------------------------------

export interface FanOutConfig<S extends BaseSwarmState> {
  agents: SwarmAgentDef<S>[];
  reducer: (agentResults: Record<string, unknown>, weights?: Record<string, number>) => Partial<S>;
  channels?: Partial<ChannelSchema<S>>;
  /** Max agents to run simultaneously (default: all). */
  maxConcurrency?: number;
  /** Per-agent timeout in ms. Agents that exceed this are marked with _error. */
  timeoutMs?: number;
  /** Per-agent weights passed to the reducer as second argument. */
  weights?: Record<string, number>;
}

// ----------------------------------------------------------------
// PipelineConfig — config object for the pipeline template
// ----------------------------------------------------------------

export interface PipelineConfig<S extends BaseSwarmState> {
  stages: SwarmAgentDef<S>[];
  transitions?: Record<string, (state: S) => string | typeof END>;
  channels?: Partial<ChannelSchema<S>>;
}

// ----------------------------------------------------------------
// PeerNetworkConfig — config object for the peer network template
// ----------------------------------------------------------------

export interface PeerNetworkConfig<S extends BaseSwarmState> {
  agents: SwarmAgentDef<S>[];
  entrypoint: string;
  handoffs: Record<string, (state: S) => string | typeof END>;
  channels?: Partial<ChannelSchema<S>>;
}

// ----------------------------------------------------------------
// MapReduceConfig — config object for the map-reduce template
// ----------------------------------------------------------------

export interface MapReduceConfig<S extends BaseSwarmState> {
  mapper: SwarmAgentDef<S>;
  poolSize?: number;
  poolStrategy?: "round-robin" | "least-busy" | "random";
  inputField: keyof S;
  reducer: (agentResults: Record<string, unknown>) => Partial<S>;
  channels?: Partial<ChannelSchema<S>>;
}

// ----------------------------------------------------------------
// DebateConfig — config object for the debate template
// ----------------------------------------------------------------

export interface DebateConfig<S extends BaseSwarmState> {
  debaters: SwarmAgentDef<S>[];
  judge: {
    model: ONIModel;
    systemPrompt?: string;
    maxRounds: number;
    consensusKeyword?: string;
    /** Enable per-round scoring of debaters (scores stored in context.debateScores). */
    scoreDebaters?: boolean;
    /** Auto-consensus when score spread is within this threshold. */
    consensusThreshold?: number;
  };
  topic: keyof S;
  channels?: Partial<ChannelSchema<S>>;
}

// ----------------------------------------------------------------
// HierarchicalMeshConfig — config object for the hierarchical mesh template
// ----------------------------------------------------------------

export interface HierarchicalMeshConfig<S extends BaseSwarmState> {
  coordinator: {
    model: ONIModel;
    strategy: "llm" | "rule" | "round-robin";
    rules?: Array<{ condition: (task: string, context: Record<string, unknown>) => boolean; agentId: string }>;
    systemPrompt?: string;
    maxRounds?: number;
  };
  teams: Record<string, {
    topology: "pipeline" | "peerNetwork";
    agents: SwarmAgentDef<S>[];
    handoffs?: Record<string, (state: S) => string | typeof END>;
  }>;
  channels?: Partial<ChannelSchema<S>>;
}

export interface SwarmCompileOpts<S> {
  checkpointer?:    ONICheckpointer<S>;
  interruptBefore?: string[];
  interruptAfter?:  string[];
  store?:           BaseStore;
  guardrails?:      GuardrailsConfig;
  listeners?:       EventListeners;
  defaults?: {
    nodeTimeout?: number;
  };
  deadLetterQueue?: boolean;
  tracer?:          TracerLike;
}

export interface SwarmExtensions<S extends Record<string, unknown>> {
  registry:   AgentRegistry<S>;
  agentStats: () => ReturnType<AgentRegistry<S>["stats"]>;
  toMermaid:  () => string;
  /** Dynamically spawn a new agent into the compiled swarm */
  spawnAgent: (def: SwarmAgentDef<S>) => void;
  /** Remove an agent from the compiled swarm (marks as terminated) */
  removeAgent: (agentId: string) => void;
}
