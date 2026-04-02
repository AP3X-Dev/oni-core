// ============================================================
// @oni.bot/core/harness — Public API
// ============================================================

// Core loop
export { agentLoop, wrapWithAgentLoop } from "./agent-loop.js";

// Working memory
export { TodoModule } from "./todo-module.js";
export type { Todo, TodoState, TodoStatus, TodoPriority } from "./todo-module.js";

// Lifecycle hooks
export { HooksEngine } from "./hooks-engine.js";
export type {
  HookEvent, HookDefinition, HookResult, HooksConfig,
  BasePayload, SessionStartPayload, SessionEndPayload,
  PreToolUsePayload, PostToolUsePayload, PostToolUseFailurePayload,
  StopPayload, PreCompactPayload, PostCompactPayload, SubagentPayload,
  UserPromptPayload,
} from "./hooks-engine.js";

// Context compaction
export { ContextCompactor } from "./context-compactor.js";
export type { CompactorConfig } from "./context-compactor.js";

// Safety gate
export { SafetyGate } from "./safety-gate.js";
export type { SafetyGateConfig, SafetyCheckResult } from "./safety-gate.js";

// Skill loader
export { SkillLoader } from "./skill-loader.js";
export type { SkillDefinition } from "./skill-loader.js";

// Memory loader
export { MemoryLoader } from "./memory-loader.js";
export type {
  MemoryUnit,
  MemoryLoaderConfig,
  MemoryTier,
  MemoryType,
  LoadResult,
} from "./memory-loader.js";
export { MemoryExtractor } from "./memory/extractor.js";

// Integration layer
export { ONIHarness } from "./harness.js";
export type { SwarmAgentCompat } from "./harness.js";

// Types
export type {
  HarnessToolContext, LoopMessage, LoopMessageType, LoopToolResult,
  ToolMetadataUpdate,
  AgentLoopConfig, HarnessConfig, AgentNodeConfig,
  SessionOutcome,
} from "./types.js";
export { generateId } from "./types.js";

// Tool argument validation
export { validateToolArgs } from "./validate-args.js";

// ── Harness Upgrade Primitives ──────────────────────────────

// Errors
export {
  ONIHarnessError,
  FeatureRegistryMutationError,
  FeatureRegistryAlreadyInitializedError,
  FeatureNotFoundError,
  SessionBridgeNotOpenError,
  EnvironmentUnhealthyError,
  ContractNotFoundError,
  ContractNotApprovedError,
  ContractAlreadyFinalizedError,
  WorkspaceGitUnavailableWarning,
} from "./errors.js";

// Utilities
export { randomId, atomicWriteJSON, readJSON, withFileLock, execGit, isGitAvailable, sanitizeForPrompt } from "./utils.js";

// Feature registry
export { FeatureRegistry } from "./FeatureRegistry.js";
export type { Feature, FeatureRegistrySnapshot, FeatureRegistrySummary, FeatureInit } from "./FeatureRegistry.js";

// Session bridge
export { SessionBridge } from "./SessionBridge.js";
export type { SessionMode, SessionArtifact } from "./SessionBridge.js";

// Workspace checkpointer
export { WorkspaceCheckpointer } from "./WorkspaceCheckpointer.js";
export type { WorkspaceCheckpointerConfig, CheckpointCommit, CheckpointMetadata } from "./WorkspaceCheckpointer.js";

// Session init
export { runSessionInit } from "./SessionInit.js";
export type { SessionInitConfig, SessionInitResult } from "./SessionInit.js";

// Context reset
export { ContextReset } from "./ContextReset.js";
export type { ContextResetConfig, ResetResult } from "./ContextReset.js";

// Negotiated handoff
export { NegotiatedHandoff } from "./NegotiatedHandoff.js";
export type {
  WorkProposal, VerificationCriterion, ProposalReview,
  ReviewDecision, NegotiatedContract, ContractStatus,
} from "./NegotiatedHandoff.js";

// Background agent
export { spawnAgent } from "./background-agent.js";
export type { AgentHandle, AgentStatus, SpawnAgentOptions } from "./background-agent.js";
