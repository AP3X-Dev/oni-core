// ============================================================
// @oni.bot/core/swarm — Public API
// ============================================================

export { SwarmGraph, baseSwarmChannels, quickAgent } from "./graph.js";
export type { BaseSwarmState, SwarmCompileOpts, SwarmExtensions, HierarchicalConfig, FanOutConfig, PipelineConfig, PeerNetworkConfig, MapReduceConfig, DebateConfig, HierarchicalMeshConfig } from "./graph.js";
export type { SwarmCompileOpts as SwarmCompileOptions } from "./graph.js";

// GAN loop types
export type {
  AgentDefinition, EvaluationCriterion, CriterionScore,
  GANIterationResult, GANLoopConfig, GANState,
} from "./graph.js";

export { AgentRegistry }                      from "./registry.js";
export type { AgentRecord }                   from "./registry.js";

export { AgentPool, BatchError }               from "./pool.js";

export { createSupervisorNode }               from "./supervisor.js";
export type { SupervisorState }               from "./supervisor.js";

export { createMessage, getInbox, consumeInbox, formatInbox } from "./mailbox.js";

export { Handoff }                            from "./types.js";
export type {
  SwarmAgentDef,
  AgentStatus,
  AgentCapability,
  AgentLifecycleHooks,
  AgentErrorContext,
  HandoffOptions,
  HandoffRecord,
  SwarmMessage,
  SwarmMeta,
  SupervisorConfig,
  SupervisorRoutingStrategy,
  RuleRoute,
  AgentPoolConfig,
  SwarmTopology,
} from "./types.js";

// Swarm utilities
export { SwarmTracer }                        from "./tracer.js";
export type { SwarmEvent, SwarmEventListener } from "./tracer.js";

export { toSwarmMermaid }                     from "./mermaid.js";

export { SwarmSnapshotStore }                 from "./snapshot.js";
export type { SwarmSnapshot, SwarmSnapshotDiff, SnapshotCaptureOptions } from "./snapshot.js";

export type { AgentManifestEntry }            from "./registry.js";

export { DynamicScalingMonitor }              from "./scaling.js";
export type { ScalingConfig, ScalingDecision, ScalingHistoryEntry } from "./scaling.js";

export { ExperimentLog, parseManifest, loadManifest, identifyPatterns, suggestNext, SkillEvolver } from "./self-improvement/index.js";
export type { ExperimentRecord, ObjectiveManifest, ManifestGoal, Pattern, DecisionContext, SkillPerformanceReport, SkillUsageRecord } from "./self-improvement/index.js";
