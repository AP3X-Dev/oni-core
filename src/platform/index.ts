// ============================================================
// @oni.bot/core/platform - Public API
// ============================================================

export type {
  AgentAction,
  AgentIdentity,
  AgentRouter,
  AgentRunOutcome,
  AgentRunRequest,
  AgentSession,
  AgentSessionRunner,
  AgentSessionStatus,
  AgentSessionStore,
  AgentTrigger,
  ArtifactStore,
  BackgroundAgentPlatformConfig,
  Capability,
  CapabilityBroker,
  CapabilityGrant,
  CapabilityRequest,
  CapacityControls,
  EnvironmentSize,
  ExecutionEnvironment,
  ExecutionEnvironmentProvider,
  ExecutionEnvironmentRequest,
  ExecutionEnvironmentStatus,
  IdentityProvider,
  IdentityRequest,
  OutputArtifact,
  OutputArtifactInput,
  OutputArtifactType,
  PlatformAuditEvent,
  PlatformAuditEventType,
  PlatformLogger,
  PlatformLogLevel,
  PlatformLogRecord,
  RepositoryRef,
  ReviewDecisionRecord,
  ReviewDecisionStatus,
  ReviewGate,
  ReviewRequest,
  RouteDecision,
  SubmitTaskInput,
  TaskReviewPolicy,
  TaskScope,
  TaskSpec,
  TriggerKind,
  WaitForSessionOptions,
} from "./types.js";

export {
  BackgroundAgentPlatform,
  InMemoryAgentSessionStore,
  InMemoryArtifactStore,
  InMemoryCapabilityBroker,
  InMemoryExecutionEnvironmentProvider,
  InMemoryReviewGate,
  StaticAgentRouter,
  StaticIdentityProvider,
  validateTaskSpec,
} from "./in-memory.js";
export {
  JsonFileAgentSessionStore,
  JsonFileArtifactStore,
} from "./filesystem.js";
export {
  SqliteAgentSessionStore,
  SqliteArtifactStore,
  createSqlitePlatformStores,
  createSqlitePlatformStoresFromDatabase,
} from "./sqlite-store.js";
export type {
  SqlitePlatformDatabase,
  SqlitePlatformStoreOptions,
  SqlitePlatformStores,
} from "./sqlite-store.js";
export {
  PostgresAgentSessionStore,
  PostgresArtifactStore,
  createPostgresPlatformStores,
  createPostgresPlatformStoresFromClient,
} from "./postgres-store.js";
export type {
  PostgresPlatformClient,
  PostgresPlatformQueryResult,
  PostgresPlatformStoreOptions,
  PostgresPlatformStores,
} from "./postgres-store.js";
export {
  GitHubArtifactStore,
} from "./github-artifacts.js";
export type {
  GitHubArtifactPublishMetadata,
  GitHubArtifactStoreOptions,
} from "./github-artifacts.js";
export {
  LocalExecutionEnvironmentProvider,
} from "./local-environment.js";
export type {
  LocalExecutionEnvironmentProviderOptions,
} from "./local-environment.js";
export {
  CerebroExecutionEnvironmentProvider,
  HttpExecutionEnvironmentProvider,
} from "./http-environment.js";
export type {
  CerebroExecutionEnvironmentProviderOptions,
  HttpEnvironmentFetch,
  HttpEnvironmentFetchResponse,
  HttpEnvironmentPath,
  HttpExecutionEnvironmentProviderOptions,
} from "./http-environment.js";
export {
  PlatformPolicyError,
  createRuntimePolicy,
  createRuntimePolicyFromParts,
  pathLooksInside,
} from "./policy.js";
export type {
  RuntimePolicy,
  RuntimePolicySnapshot,
} from "./policy.js";
export {
  ExternalAgentSessionRunner,
  createExternalAgentSessionRunner,
} from "./external-agent-runner.js";
export type {
  ExternalAgentSessionRunnerOptions,
} from "./external-agent-runner.js";
export {
  ChatCommandTriggerAdapter,
  CliTriggerAdapter,
  DependencyAlertTriggerAdapter,
  GitHubWebhookTriggerAdapter,
  ScheduledTriggerAdapter,
  createChatCommandTrigger,
  createCliTrigger,
  createDependencyAlertTrigger,
  createGitHubWebhookTrigger,
  createScheduledTrigger,
  verifyGitHubWebhookSignature,
} from "./triggers.js";
export type {
  ChatCommandTriggerInput,
  CliTriggerInput,
  DependencyAlertTriggerInput,
  GitHubWebhookTriggerInput,
  PlatformTriggerAdapter,
  PlatformTriggerAdapterOptions,
  ScheduledTriggerInput,
} from "./triggers.js";
export {
  wrapToolWithRuntimePolicy,
  wrapToolsWithRuntimePolicy,
} from "./tool-policy.js";
export type {
  PlatformToolPolicyMap,
  PlatformToolPolicyOptions,
} from "./tool-policy.js";
export {
  summarizePlatformAudit,
  summarizePlatformHealth,
} from "./observability.js";
export {
  EXTERNAL_AGENT_EVENT_TAXONOMY,
  EXTERNAL_AGENT_EVENT_TAXONOMY_VERSION,
  externalAgentEventPhase,
  isTerminalExternalAgentEvent,
} from "./event-taxonomy.js";
export type {
  ExternalAgentLifecyclePhase,
  ExternalAgentEventTaxonomyEntry,
} from "./event-taxonomy.js";
export {
  redactSecrets,
  collectRedactionValues,
  REDACTION_PLACEHOLDER,
} from "./redaction.js";
export type {
  PlatformAuditSummary,
  PlatformAuditSummaryOptions,
  PlatformHealthSnapshot,
  PlatformHealthSnapshotOptions,
  PlatformSessionSummary,
} from "./observability.js";
export {
  AgentLoopSessionRunner,
  createAgentLoopSessionRunner,
} from "./agent-loop-runner.js";
export type {
  AgentLoopSessionRunnerOptions,
} from "./agent-loop-runner.js";
export {
  SwarmSessionRunner,
  createSwarmSessionRunner,
} from "./swarm-runner.js";
export type {
  SwarmRunnable,
  SwarmSessionRunnerOptions,
} from "./swarm-runner.js";
