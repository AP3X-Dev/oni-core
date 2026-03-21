// ============================================================
// @oni.bot/core v1.0.1 — Public API
// ============================================================

// -- Graph builder & skeletons
export { StateGraph, MessageGraph }   from "./graph.js";
export type { CompileOptions, ONIMessage, ONIToolCall, MessageState, ONISkeletonV3 } from "./graph.js";

// -- Checkpointers
export { MemoryCheckpointer, NoopCheckpointer, PersistentCheckpointer } from "./checkpoint.js";
export { SqliteCheckpointer, NamespacedCheckpointer, PostgresCheckpointer, RedisCheckpointer } from "./checkpointers/index.js";

// -- Sentinel values
export { START, END } from "./types.js";

// -- Channel constructors
export { lastValue, appendList, mergeObject, ephemeralValue } from "./types.js";

// -- Send + Command
export { Send, Command } from "./types.js";
export type { CommandOptions } from "./types.js";

// -- Messages (addMessages reducer)
export {
  messagesChannel, messagesReducer, messagesStateChannels,
  RemoveMessage, UpdateMessage,
  humanMessage, aiMessage, systemMessage, toolMessage,
  getMessageById, filterByRole, trimMessages,
} from "./messages/index.js";
export type { Message, BaseMessage, MessagesState, MessageUpdate } from "./messages/index.js";

// -- HITL: interrupt() + getUserInput
export {
  interrupt, getUserInput, getUserApproval, getUserSelection,
  HITLSessionStore, HITLInterruptException,
  NodeInterruptSignal,
} from "./hitl/index.js";
export type { InterruptValue, ResumeValue, GetUserInputOptions, HITLSession } from "./hitl/index.js";

// -- Cross-thread Store
export {
  InMemoryStore, NamespacedStore, AgentMemoryStore,
} from "./store/index.js";
export type { StoreItem, SearchResult, Namespace, StoreKey, EmbedFn } from "./store/index.js";
export { BaseStore } from "./store/index.js";

// -- Injected tools
export { createInjectedTool } from "./injected.js";
export type { InjectedTool, InjectedToolOptions } from "./injected.js";

// -- Runtime Context
export { getConfig, getStore, getStreamWriter, getCurrentState, getRemainingSteps } from "./context.js";
export type { RunContext, StreamWriter } from "./context.js";

// -- Token streaming
export { emitToken, TokenStreamWriter, StreamWriterImpl, BoundedBuffer } from "./streaming.js";
export type { TokenStreamEvent, AnyStreamEvent, BackpressureStrategy } from "./streaming.js";

// -- Stream events protocol
export { streamEvents } from "./stream-events.js";
export type { StreamEvent } from "./stream-events.js";

// -- Graph inspection
export { buildGraphDescriptor, toMermaidDetailed } from "./inspect.js";
export type { GraphDescriptor, GraphNode, GraphEdge, NodeType } from "./inspect.js";

// -- Functional API
export { entrypoint, pipe, branch, task } from "./functional.js";
export type { TaskDef, EntrypointOptions, TaskOptions } from "./functional.js";

// -- Retry
export { withRetry } from "./retry.js";

// -- Circuit Breaker
export { CircuitBreaker } from "./circuit-breaker.js";
export type { CircuitState, CircuitBreakerConfig } from "./circuit-breaker.js";

// -- Dead Letter Queue
export { DeadLetterQueue } from "./dlq.js";
export type { DeadLetter } from "./dlq.js";

// -- Swarm primitives
export {
  SwarmGraph, AgentRegistry, AgentPool, AgentPool as Pool, BatchError,
  Handoff, createSupervisorNode, baseSwarmChannels, quickAgent,
  createMessage, getInbox, consumeInbox, formatInbox,
  SwarmTracer, SwarmSnapshotStore, DynamicScalingMonitor, toSwarmMermaid,
} from "./swarm/index.js";
export type {
  SwarmAgentDef, AgentStatus, AgentCapability,
  AgentErrorContext, AgentLifecycleHooks,
  HandoffOptions, HandoffRecord,
  SwarmMessage, SwarmMeta, BaseSwarmState,
  SupervisorConfig, SupervisorState, SupervisorRoutingStrategy,
  RuleRoute, AgentPoolConfig,
  SwarmTopology, SwarmExtensions, SwarmCompileOptions,
  HierarchicalConfig, FanOutConfig, PipelineConfig, PeerNetworkConfig, MapReduceConfig, DebateConfig, HierarchicalMeshConfig,
  AgentManifestEntry, AgentRecord,
  SwarmEvent, SwarmEventListener,
  SwarmSnapshot, SwarmSnapshotDiff, SnapshotCaptureOptions,
  ScalingConfig, ScalingDecision, ScalingHistoryEntry,
} from "./swarm/index.js";

// -- Self-improvement
export { ExperimentLog, parseManifest, loadManifest, identifyPatterns, suggestNext, SkillEvolver } from "./swarm/self-improvement/index.js";
export type { ExperimentRecord, ObjectiveManifest, ManifestGoal, Pattern, DecisionContext, SkillPerformanceReport, SkillUsageRecord, SkillEvolverConfig, SkillTestFn } from "./swarm/self-improvement/index.js";
export { ExperimentalExecutor } from "./harness/loop/experimental-executor.js";
export type { ExperimentResult, ExperimentOptions } from "./harness/loop/experimental-executor.js";

// -- Prebuilt nodes
export { createToolNode, toolsCondition, createReactAgent } from "./prebuilt/index.js";
export type { ONITool, CreateReactAgentOptions, ONILanguageModel, LLMToolSchema } from "./prebuilt/index.js";

// -- Agents
export type { AgentNode, AgentContext, DefineAgentOptions, FunctionalAgentOptions, SwarmMessageView } from "./agents/index.js";
export { defineAgent } from "./agents/define-agent.js";
export { agent } from "./agents/functional-agent.js";
export { buildAgentContext } from "./agents/context.js";

// -- Core types
export type {
  Channel, ChannelSchema, Annotated,
  NodeFn, NodeReturn, NodeDefinition,
  Edge, StaticEdge, ConditionalEdge,
  InterruptConfig, DynamicInterrupt,
  RetryPolicy, CachePolicy,
  ONIConfig,
  ONICheckpoint, ONICheckpointer,
  CheckpointListOptions,
  ONISkeleton,
  ONIStreamEvent, ONIInterruptEvent,
  CustomStreamEvent, MessageStreamEvent,
  StreamMode,
  NodeName, StartNode, EndNode,
} from "./types.js";

// -- Telemetry (zero-dep OTel adapter)
export { ONITracer } from "./telemetry.js";
export type { SpanLike, TracerLike } from "./telemetry.js";

// -- Errors
export {
  ONIError, InvalidSkeletonError, RecursionLimitError,
  NodeNotFoundError, EdgeConflictError, NodeExecutionError,
  NodeTimeoutError, CircuitBreakerOpenError, SwarmDeadlockError,
  ModelAPIError, ModelRateLimitError, ModelContextLengthError,
  CheckpointCorruptError, StoreKeyNotFoundError,
  ONIInterrupt,
} from "./errors.js";
export type { ErrorCategory, ONIErrorOptions } from "./errors.js";

// Tools
export type { ToolDefinition, ToolContext, DefineToolOptions, ToolPermissions } from "./tools/index.js";
export { defineTool, executeTool, executeToolCalls } from "./tools/index.js";

// Coordination
export { RequestReplyBroker } from "./coordination/request-reply.js";
export type { PendingRequest } from "./coordination/request-reply.js";
export { PubSub, topicMatches } from "./coordination/pubsub.js";
export type { TopicMessage } from "./coordination/pubsub.js";

// Events
export type { LifecycleEvent, EventType, EventHandler, EventListeners } from "./events/index.js";
export { EventBus } from "./events/index.js";

// Guardrails
export type { GuardrailsConfig, BudgetConfig, ContentFilter, ContentFilterResult, AuditEntry } from "./guardrails/index.js";
export { checkToolPermission, getPermittedTools, ToolPermissionError } from "./guardrails/index.js";
export { BudgetTracker, BudgetExceededError } from "./guardrails/index.js";
export { piiFilter, topicFilter, customFilter, runFilters } from "./guardrails/index.js";
export { AuditLog } from "./guardrails/index.js";

// Models
export type {
  ONIModel,
  ONIModelMessage,
  ONIModelToolCall,
  ChatParams,
  ChatResponse,
  ChatChunk,
  TokenUsage,
  ModelCapabilities,
  ModelOptions,
  LLMToolDef,
  JSONSchema,
} from "./models/index.js";
export { anthropic } from "./models/anthropic.js";
export { openai } from "./models/openai.js";
export { openrouter } from "./models/openrouter.js";
export type { OpenRouterOptions } from "./models/openrouter.js";
export { google } from "./models/google.js";
export { ollama } from "./models/ollama.js";

// Harness (agentic loop layer)
export {
  ONIHarness, agentLoop, wrapWithAgentLoop,
  TodoModule, HooksEngine, ContextCompactor, SafetyGate, SkillLoader,
  generateId,
} from "./harness/index.js";
export type {
  HarnessConfig, AgentNodeConfig, AgentLoopConfig,
  LoopMessage, LoopMessageType, LoopToolResult,
  HarnessToolContext, SwarmAgentCompat,
  Todo, TodoState, TodoStatus, TodoPriority,
  HookEvent, HookDefinition, HookResult, HooksConfig,
  CompactorConfig, SafetyGateConfig, SafetyCheckResult,
  SkillDefinition,
} from "./harness/index.js";
