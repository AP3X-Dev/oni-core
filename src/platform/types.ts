// ============================================================
// @oni.bot/core/platform - Background agent platform types
// ============================================================
// Provider-neutral primitives for turning triggers plus task specs
// into governed, isolated, observable agent sessions.
// ============================================================

import type { TracerLike } from "../telemetry.js";

export type AgentAction =
  | "read"
  | "write"
  | "test"
  | "shell"
  | "network"
  | "mcp"
  | "lsp"
  | "vcs"
  | "artifact"
  | "review";

export type AgentSessionStatus =
  | "queued"
  | "provisioning"
  | "running"
  | "awaiting_review"
  | "completed"
  | "failed"
  | "cancelled";

export type TriggerKind =
  | "manual"
  | "schedule"
  | "webhook"
  | "vcs"
  | "chat"
  | "dependency"
  | "security"
  | "custom";

export type ExecutionEnvironmentStatus =
  | "provisioning"
  | "ready"
  | "unhealthy"
  | "released";

export type EnvironmentSize = "small" | "medium" | "large" | "xlarge";

export type OutputArtifactType =
  | "pull_request"
  | "patch"
  | "review_comment"
  | "report"
  | "test_summary"
  | "issue_triage"
  | "release_note"
  | "failed_run_diagnosis"
  | "custom";

export type ReviewDecisionStatus =
  | "pending"
  | "approved"
  | "changes_requested"
  | "rejected";

export type PlatformAuditEventType =
  | "session.created"
  | "session.queued"
  | "session.routed"
  | "session.running"
  | "session.completed"
  | "session.failed"
  | "session.cancelled"
  | "environment.provisioned"
  | "environment.released"
  | "identity.issued"
  | "identity.revoked"
  | "capability.granted"
  | "capability.revoked"
  | "policy.denied"
  | "artifact.created"
  | "review.requested"
  | "review.resolved"
  | "budget.warning";

export interface RepositoryRef {
  provider?: string;
  owner?: string;
  name?: string;
  url?: string;
  ref?: string;
  baseBranch?: string;
  workBranch?: string;
}

export interface TaskScope {
  allowedPaths?: string[];
  disallowedPaths?: string[];
  allowedCommands?: string[];
  network?: "none" | "restricted" | "full";
  connectors?: string[];
  secrets?: string[];
}

export interface TaskReviewPolicy {
  required?: boolean;
  reviewers?: string[];
  artifactTypes?: OutputArtifactType[];
}

export interface TaskSpec {
  id?: string;
  title: string;
  goal: string;
  repo?: RepositoryRef;
  scope?: TaskScope;
  constraints?: string[];
  successCriteria: string[];
  allowedActions?: AgentAction[];
  review?: TaskReviewPolicy;
  outputFormat?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentTrigger {
  id?: string;
  kind: TriggerKind;
  source: string;
  actor?: string;
  firedAt?: string;
  correlationId?: string;
  payload?: Record<string, unknown>;
}

export interface RouteDecision {
  agentId: string;
  runtime?: string;
  provider?: string;
  model?: string;
  mode?: string;
  priority?: "low" | "normal" | "high" | "critical";
  environmentSize?: EnvironmentSize;
  timeoutMs?: number;
  requiredTools?: string[];
  metadata?: Record<string, unknown>;
}

export interface AgentRouter {
  route(task: TaskSpec, trigger: AgentTrigger): Promise<RouteDecision> | RouteDecision;
}

export interface ExecutionEnvironment {
  id: string;
  provider: string;
  status: ExecutionEnvironmentStatus;
  size: EnvironmentSize;
  workspaceDir?: string;
  image?: string;
  createdAt: string;
  updatedAt: string;
  releasedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ExecutionEnvironmentRequest {
  sessionId: string;
  task: TaskSpec;
  trigger: AgentTrigger;
  route: RouteDecision;
}

export interface ExecutionEnvironmentProvider {
  provision(request: ExecutionEnvironmentRequest): Promise<ExecutionEnvironment> | ExecutionEnvironment;
  release(environment: ExecutionEnvironment, reason: string): Promise<void> | void;
  health?(environment: ExecutionEnvironment): Promise<boolean> | boolean;
}

export interface AgentIdentity {
  id: string;
  subject: string;
  sessionId: string;
  taskId?: string;
  actor?: string;
  scopes: string[];
  issuedAt: string;
  expiresAt?: string;
  revokedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface IdentityRequest {
  sessionId: string;
  task: TaskSpec;
  trigger: AgentTrigger;
  environment: ExecutionEnvironment;
  route: RouteDecision;
}

export interface IdentityProvider {
  issueIdentity(request: IdentityRequest): Promise<AgentIdentity> | AgentIdentity;
  revokeIdentity?(identity: AgentIdentity, reason: string): Promise<void> | void;
}

export interface Capability {
  name: string;
  type: "tool" | "secret" | "connector" | "network" | "repo" | "command" | "custom";
  scope?: string;
  metadata?: Record<string, unknown>;
}

export interface CapabilityGrant {
  id: string;
  sessionId: string;
  identityId: string;
  status: "active" | "revoked";
  capabilities: Capability[];
  issuedAt: string;
  revokedAt?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface CapabilityRequest {
  sessionId: string;
  task: TaskSpec;
  trigger: AgentTrigger;
  route: RouteDecision;
  environment: ExecutionEnvironment;
  identity: AgentIdentity;
}

export interface CapabilityBroker {
  grant(request: CapabilityRequest): Promise<CapabilityGrant> | CapabilityGrant;
  revoke(grant: CapabilityGrant, reason: string): Promise<void> | void;
  assertAllowed?(grant: CapabilityGrant, capabilityName: string): void;
}

export interface OutputArtifactInput {
  id?: string;
  type: OutputArtifactType;
  title: string;
  content?: string;
  uri?: string;
  metadata?: Record<string, unknown>;
}

export interface OutputArtifact extends OutputArtifactInput {
  id: string;
  sessionId: string;
  createdAt: string;
}

export interface ArtifactStore {
  put(artifact: OutputArtifact): Promise<OutputArtifact | void> | OutputArtifact | void;
  list(sessionId: string): Promise<OutputArtifact[]> | OutputArtifact[];
}

export interface ReviewRequest {
  sessionId: string;
  task: TaskSpec;
  trigger: AgentTrigger;
  route: RouteDecision;
  artifacts: OutputArtifact[];
  reviewers: string[];
}

export interface ReviewDecisionRecord {
  id: string;
  sessionId: string;
  status: ReviewDecisionStatus;
  reviewer?: string;
  notes?: string;
  requestedAt: string;
  resolvedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ReviewGate {
  requestReview(request: ReviewRequest): Promise<ReviewDecisionRecord> | ReviewDecisionRecord;
  submitReview?(
    sessionId: string,
    decision: Omit<ReviewDecisionRecord, "id" | "sessionId" | "requestedAt">,
  ): Promise<ReviewDecisionRecord> | ReviewDecisionRecord;
}

export interface PlatformAuditEvent {
  id: string;
  type: PlatformAuditEventType;
  timestamp: string;
  sessionId?: string;
  actor?: string;
  data?: Record<string, unknown>;
}

export interface AgentRunTelemetry {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface AgentSession {
  id: string;
  task: TaskSpec;
  trigger: AgentTrigger;
  status: AgentSessionStatus;
  route?: RouteDecision;
  environment?: ExecutionEnvironment;
  identity?: AgentIdentity;
  capabilityGrant?: CapabilityGrant;
  artifacts: OutputArtifact[];
  review?: ReviewDecisionRecord;
  audit: PlatformAuditEvent[];
  telemetry?: AgentRunTelemetry;
  result?: string;
  error?: string;
  priority: "low" | "normal" | "high" | "critical";
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentSessionStore {
  create(session: AgentSession): Promise<void> | void;
  save(session: AgentSession): Promise<void> | void;
  get(sessionId: string): Promise<AgentSession | null> | AgentSession | null;
  list(filter?: { status?: AgentSessionStatus }): Promise<AgentSession[]> | AgentSession[];
}

export interface AgentRunRequest {
  session: AgentSession;
  task: TaskSpec;
  trigger: AgentTrigger;
  route: RouteDecision;
  environment: ExecutionEnvironment;
  identity: AgentIdentity;
  capabilityGrant: CapabilityGrant;
  signal?: AbortSignal;
}

export interface AgentRunOutcome {
  status?: "completed" | "failed";
  summary: string;
  artifacts?: OutputArtifactInput[];
  telemetry?: AgentRunTelemetry;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface AgentSessionRunner {
  run(request: AgentRunRequest): Promise<AgentRunOutcome>;
}

export interface CapacityControls {
  maxConcurrentSessions?: number;
  maxQueuedSessions?: number;
  defaultTimeoutMs?: number;
  maxSessionMs?: number;
  maxCostUsdPerSession?: number;
}

export type PlatformLogLevel = "debug" | "info" | "warn" | "error";

export interface PlatformLogRecord {
  level: PlatformLogLevel;
  message: string;
  timestamp: string;
  sessionId?: string;
  taskId?: string;
  phase?: string;
  data?: Record<string, unknown>;
  error?: string;
}

export interface PlatformLogger {
  log(record: PlatformLogRecord): void;
}

export interface SubmitTaskInput {
  task: TaskSpec;
  trigger?: AgentTrigger;
  metadata?: Record<string, unknown>;
}

export interface WaitForSessionOptions {
  timeoutMs?: number;
  includeAwaitingReview?: boolean;
}

export interface BackgroundAgentPlatformConfig {
  router: AgentRouter;
  runner: AgentSessionRunner;
  environmentProvider?: ExecutionEnvironmentProvider;
  identityProvider?: IdentityProvider;
  capabilityBroker?: CapabilityBroker;
  artifactStore?: ArtifactStore;
  reviewGate?: ReviewGate;
  sessionStore?: AgentSessionStore;
  capacity?: CapacityControls;
  logger?: PlatformLogger;
  tracer?: TracerLike;
  clock?: () => Date;
  idFactory?: (prefix: string) => string;
}
