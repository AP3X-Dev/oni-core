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
