// ============================================================
// @oni.bot/core/platform - In-memory platform implementation
// ============================================================
// A small reusable control plane. Production callers can replace
// every provider with durable/cloud-backed implementations.
// ============================================================

import { randomUUID } from "node:crypto";
import type {
  AgentIdentity,
  AgentRouter,
  AgentRunOutcome,
  AgentSession,
  AgentSessionStatus,
  AgentSessionStore,
  ArtifactStore,
  BackgroundAgentPlatformConfig,
  Capability,
  CapabilityBroker,
  CapabilityGrant,
  CapacityControls,
  ExecutionEnvironment,
  ExecutionEnvironmentProvider,
  IdentityProvider,
  OutputArtifact,
  OutputArtifactInput,
  PlatformAuditEvent,
  PlatformAuditEventType,
  PlatformLogger,
  ReviewDecisionRecord,
  ReviewGate,
  RouteDecision,
  SubmitTaskInput,
  TaskSpec,
  WaitForSessionOptions,
  AgentTrigger,
  AgentSessionRunner,
} from "./types.js";
import type { SpanLike, TracerLike } from "../telemetry.js";
import {
  summarizePlatformAudit,
  summarizePlatformHealth,
  type PlatformAuditSummary,
  type PlatformAuditSummaryOptions,
  type PlatformHealthSnapshot,
  type PlatformHealthSnapshotOptions,
} from "./observability.js";

type SessionWaiter = {
  resolve: (session: AgentSession) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
  includeAwaitingReview: boolean;
};

const DEFAULT_CAPACITY: Required<CapacityControls> = {
  maxConcurrentSessions: 4,
  maxQueuedSessions: 100,
  defaultTimeoutMs: 0,
  maxSessionMs: 0,
  maxCostUsdPerSession: Number.POSITIVE_INFINITY,
};

const TERMINAL_STATUSES = new Set<AgentSessionStatus>([
  "completed",
  "failed",
  "cancelled",
]);

const NOOP_SPAN: SpanLike = {
  setAttribute() { return this; },
  setStatus() { return this; },
  recordException() {},
  end() {},
};

function cloneRecord<T>(value: T): T {
  return structuredClone(value);
}

function summarizeCapability(capability: Capability): Record<string, unknown> {
  return {
    name: capability.name,
    type: capability.type,
    scope: capability.scope,
    metadataKeys: capability.metadata ? Object.keys(capability.metadata).sort() : undefined,
  };
}

function nowIso(clock: () => Date): string {
  return clock().toISOString();
}

function defaultId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function defaultTrigger(clock: () => Date, idFactory: (prefix: string) => string): AgentTrigger {
  return {
    id: idFactory("trg"),
    kind: "manual",
    source: "api",
    firedAt: nowIso(clock),
  };
}

function isSettled(status: AgentSessionStatus, includeAwaitingReview: boolean): boolean {
  return TERMINAL_STATUSES.has(status) || (includeAwaitingReview && status === "awaiting_review");
}

export function validateTaskSpec(task: TaskSpec): void {
  if (!task.title.trim()) {
    throw new Error("TaskSpec.title is required.");
  }
  if (!task.goal.trim()) {
    throw new Error("TaskSpec.goal is required.");
  }
  if (!Array.isArray(task.successCriteria) || task.successCriteria.length === 0) {
    throw new Error("TaskSpec.successCriteria must contain at least one criterion.");
  }
}

export class StaticAgentRouter implements AgentRouter {
  constructor(
    private readonly decision:
      | RouteDecision
      | ((task: TaskSpec, trigger: AgentTrigger) => RouteDecision | Promise<RouteDecision>),
  ) {}

  route(task: TaskSpec, trigger: AgentTrigger): RouteDecision | Promise<RouteDecision> {
    if (typeof this.decision === "function") {
      return this.decision(task, trigger);
    }
    return { ...this.decision };
  }
}

export class InMemoryAgentSessionStore implements AgentSessionStore {
  private readonly sessions = new Map<string, AgentSession>();

  create(session: AgentSession): void {
    if (this.sessions.has(session.id)) {
      throw new Error(`Session already exists: ${session.id}`);
    }
    this.sessions.set(session.id, cloneRecord(session));
  }

  save(session: AgentSession): void {
    if (!this.sessions.has(session.id)) {
      throw new Error(`Session not found: ${session.id}`);
    }
    this.sessions.set(session.id, cloneRecord(session));
  }

  get(sessionId: string): AgentSession | null {
    const session = this.sessions.get(sessionId);
    return session ? cloneRecord(session) : null;
  }

  list(filter?: { status?: AgentSessionStatus }): AgentSession[] {
    const sessions = [...this.sessions.values()];
    const filtered = filter?.status
      ? sessions.filter((session) => session.status === filter.status)
      : sessions;
    return filtered.map((session) => cloneRecord(session));
  }
}

export class InMemoryArtifactStore implements ArtifactStore {
  private readonly artifacts = new Map<string, OutputArtifact[]>();

  put(artifact: OutputArtifact): void {
    const list = this.artifacts.get(artifact.sessionId) ?? [];
    list.push(cloneRecord(artifact));
    this.artifacts.set(artifact.sessionId, list);
  }

  list(sessionId: string): OutputArtifact[] {
    return (this.artifacts.get(sessionId) ?? []).map((artifact) => cloneRecord(artifact));
  }
}

export class InMemoryExecutionEnvironmentProvider implements ExecutionEnvironmentProvider {
  private readonly environments = new Map<string, ExecutionEnvironment>();

  constructor(
    private readonly options: {
      provider?: string;
      workspaceRoot?: string;
      image?: string;
      clock?: () => Date;
      idFactory?: (prefix: string) => string;
    } = {},
  ) {}

  provision(request: {
    sessionId: string;
    route: RouteDecision;
  }): ExecutionEnvironment {
    const clock = this.options.clock ?? (() => new Date());
    const idFactory = this.options.idFactory ?? defaultId;
    const id = idFactory("env");
    const timestamp = nowIso(clock);
    const workspaceDir = this.options.workspaceRoot
      ? `${this.options.workspaceRoot.replace(/[\\/]$/, "")}/${request.sessionId}`
      : undefined;
    const environment: ExecutionEnvironment = {
      id,
      provider: this.options.provider ?? "in-memory",
      status: "ready",
      size: request.route.environmentSize ?? "small",
      workspaceDir,
      image: this.options.image,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.environments.set(id, cloneRecord(environment));
    return environment;
  }

  release(environment: ExecutionEnvironment, _reason: string): void {
    const clock = this.options.clock ?? (() => new Date());
    const existing = this.environments.get(environment.id) ?? environment;
    const released: ExecutionEnvironment = {
      ...existing,
      status: "released",
      releasedAt: nowIso(clock),
      updatedAt: nowIso(clock),
    };
    this.environments.set(environment.id, released);
  }

  get(environmentId: string): ExecutionEnvironment | null {
    const environment = this.environments.get(environmentId);
    return environment ? cloneRecord(environment) : null;
  }
}

export class StaticIdentityProvider implements IdentityProvider {
  private readonly identities = new Map<string, AgentIdentity>();

  constructor(
    private readonly options: {
      subjectPrefix?: string;
      defaultScopes?: string[];
      clock?: () => Date;
      idFactory?: (prefix: string) => string;
    } = {},
  ) {}

  issueIdentity(request: {
    sessionId: string;
    task: TaskSpec;
    trigger: AgentTrigger;
    route: RouteDecision;
  }): AgentIdentity {
    const clock = this.options.clock ?? (() => new Date());
    const idFactory = this.options.idFactory ?? defaultId;
    const scopes = new Set<string>(this.options.defaultScopes ?? []);
    for (const action of request.task.allowedActions ?? []) scopes.add(action);
    for (const tool of request.route.requiredTools ?? []) scopes.add(`tool:${tool}`);

    const identity: AgentIdentity = {
      id: idFactory("idn"),
      subject: `${this.options.subjectPrefix ?? "agent"}:${request.route.agentId}`,
      sessionId: request.sessionId,
      taskId: request.task.id,
      actor: request.trigger.actor,
      scopes: [...scopes].sort(),
      issuedAt: nowIso(clock),
    };
    this.identities.set(identity.id, cloneRecord(identity));
    return identity;
  }

  revokeIdentity(identity: AgentIdentity, _reason: string): void {
    const clock = this.options.clock ?? (() => new Date());
    const revoked = { ...identity, revokedAt: nowIso(clock) };
    this.identities.set(identity.id, revoked);
  }

  get(identityId: string): AgentIdentity | null {
    const identity = this.identities.get(identityId);
    return identity ? cloneRecord(identity) : null;
  }
}

export class InMemoryCapabilityBroker implements CapabilityBroker {
  private readonly grants = new Map<string, CapabilityGrant>();

  constructor(
    private readonly options: {
      clock?: () => Date;
      idFactory?: (prefix: string) => string;
    } = {},
  ) {}

  grant(request: {
    sessionId: string;
    task: TaskSpec;
    route: RouteDecision;
    identity: AgentIdentity;
  }): CapabilityGrant {
    const clock = this.options.clock ?? (() => new Date());
    const idFactory = this.options.idFactory ?? defaultId;
    const capabilities: Capability[] = [];

    if (request.task.repo) {
      capabilities.push({
        name: "repo",
        type: "repo",
        scope: request.task.repo.workBranch ?? request.task.repo.baseBranch ?? request.task.repo.ref,
      });
    }
    for (const command of request.task.scope?.allowedCommands ?? []) {
      capabilities.push({ name: command, type: "command" });
    }
    for (const connector of request.task.scope?.connectors ?? []) {
      capabilities.push({ name: connector, type: "connector" });
    }
    for (const secret of request.task.scope?.secrets ?? []) {
      capabilities.push({ name: secret, type: "secret" });
    }
    for (const tool of request.route.requiredTools ?? []) {
      capabilities.push({ name: tool, type: "tool" });
    }
    if (request.task.scope?.network && request.task.scope.network !== "none") {
      capabilities.push({ name: "network", type: "network", scope: request.task.scope.network });
    }

    const grant: CapabilityGrant = {
      id: idFactory("cap"),
      sessionId: request.sessionId,
      identityId: request.identity.id,
      status: "active",
      capabilities,
      issuedAt: nowIso(clock),
    };
    this.grants.set(grant.id, cloneRecord(grant));
    return grant;
  }

  revoke(grant: CapabilityGrant, _reason: string): void {
    const clock = this.options.clock ?? (() => new Date());
    const revoked: CapabilityGrant = {
      ...grant,
      status: "revoked",
      revokedAt: nowIso(clock),
    };
    this.grants.set(grant.id, cloneRecord(revoked));
  }

  assertAllowed(grant: CapabilityGrant, capabilityName: string): void {
    if (grant.status !== "active") {
      throw new Error(`Capability grant is not active: ${grant.id}`);
    }
    if (!grant.capabilities.some((capability) => capability.name === capabilityName)) {
      throw new Error(`Capability not granted: ${capabilityName}`);
    }
  }

  get(grantId: string): CapabilityGrant | null {
    const grant = this.grants.get(grantId);
    return grant ? cloneRecord(grant) : null;
  }
}

export class InMemoryReviewGate implements ReviewGate {
  private readonly decisions = new Map<string, ReviewDecisionRecord>();

  constructor(
    private readonly options: {
      autoDecision?: Exclude<ReviewDecisionRecord["status"], "pending">;
      reviewer?: string;
      clock?: () => Date;
      idFactory?: (prefix: string) => string;
    } = {},
  ) {}

  requestReview(request: { sessionId: string }): ReviewDecisionRecord {
    const clock = this.options.clock ?? (() => new Date());
    const idFactory = this.options.idFactory ?? defaultId;
    const status = this.options.autoDecision ?? "pending";
    const now = nowIso(clock);
    const decision: ReviewDecisionRecord = {
      id: idFactory("rev"),
      sessionId: request.sessionId,
      status,
      reviewer: this.options.reviewer,
      requestedAt: now,
      resolvedAt: status === "pending" ? undefined : now,
    };
    this.decisions.set(request.sessionId, cloneRecord(decision));
    return decision;
  }

  submitReview(
    sessionId: string,
    decision: Omit<ReviewDecisionRecord, "id" | "sessionId" | "requestedAt">,
  ): ReviewDecisionRecord {
    const clock = this.options.clock ?? (() => new Date());
    const idFactory = this.options.idFactory ?? defaultId;
    const existing = this.decisions.get(sessionId);
    const record: ReviewDecisionRecord = {
      id: existing?.id ?? idFactory("rev"),
      sessionId,
      status: decision.status,
      reviewer: decision.reviewer ?? existing?.reviewer,
      notes: decision.notes,
      requestedAt: existing?.requestedAt ?? nowIso(clock),
      resolvedAt: decision.status === "pending"
        ? undefined
        : decision.resolvedAt ?? nowIso(clock),
      metadata: decision.metadata,
    };
    this.decisions.set(sessionId, cloneRecord(record));
    return record;
  }

  get(sessionId: string): ReviewDecisionRecord | null {
    const decision = this.decisions.get(sessionId);
    return decision ? cloneRecord(decision) : null;
  }
}

export class BackgroundAgentPlatform {
  private readonly router: AgentRouter;
  private readonly runner: AgentSessionRunner;
  private readonly environmentProvider: ExecutionEnvironmentProvider;
  private readonly identityProvider: IdentityProvider;
  private readonly capabilityBroker: CapabilityBroker;
  private readonly artifactStore: ArtifactStore;
  private readonly reviewGate: ReviewGate;
  private readonly sessionStore: AgentSessionStore;
  private readonly capacity: Required<CapacityControls>;
  private readonly logger?: PlatformLogger;
  private readonly tracer?: TracerLike;
  private readonly clock: () => Date;
  private readonly idFactory: (prefix: string) => string;
  private readonly queue: string[] = [];
  private readonly active = new Set<string>();
  private readonly waiters = new Map<string, Set<SessionWaiter>>();
  private readonly controllers = new Map<string, AbortController>();

  constructor(config: BackgroundAgentPlatformConfig) {
    this.clock = config.clock ?? (() => new Date());
    this.idFactory = config.idFactory ?? defaultId;
    this.router = config.router;
    this.runner = config.runner;
    this.environmentProvider = config.environmentProvider ?? new InMemoryExecutionEnvironmentProvider({
      clock: this.clock,
      idFactory: this.idFactory,
    });
    this.identityProvider = config.identityProvider ?? new StaticIdentityProvider({
      clock: this.clock,
      idFactory: this.idFactory,
    });
    this.capabilityBroker = config.capabilityBroker ?? new InMemoryCapabilityBroker({
      clock: this.clock,
      idFactory: this.idFactory,
    });
    this.artifactStore = config.artifactStore ?? new InMemoryArtifactStore();
    this.reviewGate = config.reviewGate ?? new InMemoryReviewGate({
      clock: this.clock,
      idFactory: this.idFactory,
    });
    this.sessionStore = config.sessionStore ?? new InMemoryAgentSessionStore();
    this.capacity = { ...DEFAULT_CAPACITY, ...(config.capacity ?? {}) };
    this.logger = config.logger;
    this.tracer = config.tracer;
  }

  async submitTask(input: SubmitTaskInput): Promise<AgentSession> {
    validateTaskSpec(input.task);
    if (this.queue.length >= this.capacity.maxQueuedSessions) {
      throw new Error(`Session queue depth exceeded (max ${this.capacity.maxQueuedSessions}).`);
    }

    const trigger = {
      ...defaultTrigger(this.clock, this.idFactory),
      ...(input.trigger ?? {}),
      firedAt: input.trigger?.firedAt ?? nowIso(this.clock),
      id: input.trigger?.id ?? this.idFactory("trg"),
    };
    const task = {
      ...input.task,
      id: input.task.id ?? this.idFactory("task"),
    };
    const timestamp = nowIso(this.clock);
    const session: AgentSession = {
      id: this.idFactory("ses"),
      task,
      trigger,
      status: "queued",
      artifacts: [],
      audit: [],
      priority: "normal",
      createdAt: timestamp,
      updatedAt: timestamp,
      metadata: input.metadata,
    };

    this.appendAudit(session, "session.created", { taskId: task.id });
    this.appendAudit(session, "session.queued");
    await this.sessionStore.create(session);
    this.queue.push(session.id);
    this.dispatch();
    return cloneRecord(session);
  }

  async runTask(input: SubmitTaskInput, waitOptions?: WaitForSessionOptions): Promise<AgentSession> {
    const session = await this.submitTask(input);
    return this.waitForSession(session.id, waitOptions);
  }

  async getSession(sessionId: string): Promise<AgentSession | null> {
    return this.sessionStore.get(sessionId);
  }

  async listSessions(filter?: { status?: AgentSessionStatus }): Promise<AgentSession[]> {
    return this.sessionStore.list(filter);
  }

  async getHealthSnapshot(options: PlatformHealthSnapshotOptions = {}): Promise<PlatformHealthSnapshot> {
    const sessions = await this.sessionStore.list();
    return summarizePlatformHealth(sessions, {
      ...options,
      now: options.now ?? this.clock(),
      queueDepth: options.queueDepth ?? this.queue.length,
      activeSessionIds: options.activeSessionIds ?? [...this.active],
      capacity: options.capacity ?? this.capacity,
    });
  }

  async getAuditSummary(options: PlatformAuditSummaryOptions = {}): Promise<PlatformAuditSummary> {
    const sessions = await this.sessionStore.list();
    return summarizePlatformAudit(sessions, {
      ...options,
      now: options.now ?? this.clock(),
    });
  }

  private log(
    level: "debug" | "info" | "warn" | "error",
    phase: string,
    session: AgentSession | undefined,
    data?: Record<string, unknown>,
    error?: Error,
  ): void {
    if (!this.logger) return;
    try {
      this.logger.log({
        level,
        message: `platform.${phase}`,
        timestamp: nowIso(this.clock),
        sessionId: session?.id,
        taskId: session?.task.id,
        phase,
        data,
        error: error?.message,
      });
    } catch {
      // Logging must not change platform execution semantics.
    }
  }

  private startSpan(
    phase: string,
    session: AgentSession | undefined,
    attributes: Record<string, unknown> = {},
  ): SpanLike {
    if (!this.tracer) return NOOP_SPAN;
    const span = this.tracer.startSpan(`oni.platform.${phase}`);
    if (session) {
      span.setAttribute("oni.session_id", session.id);
      if (session.task.id) span.setAttribute("oni.task_id", session.task.id);
      span.setAttribute("oni.session_status", session.status);
    }
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined) span.setAttribute(`oni.${key}`, value);
    }
    return span;
  }

  private async instrument<T>(
    phase: string,
    session: AgentSession | undefined,
    attributes: Record<string, unknown>,
    fn: () => Promise<T> | T,
  ): Promise<T> {
    const span = this.startSpan(phase, session, attributes);
    this.log("debug", `${phase}.started`, session, attributes);
    try {
      const result = await fn();
      span.setStatus({ code: 1 });
      this.log("debug", `${phase}.completed`, session, attributes);
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      span.recordException(err);
      span.setStatus({ code: 2, message: err.message });
      this.log("error", `${phase}.failed`, session, attributes, err);
      throw error;
    } finally {
      span.end();
    }
  }

  async waitForSession(sessionId: string, options: WaitForSessionOptions = {}): Promise<AgentSession> {
    const includeAwaitingReview = options.includeAwaitingReview ?? true;
    const current = await this.sessionStore.get(sessionId);
    if (!current) throw new Error(`Session not found: ${sessionId}`);
    if (isSettled(current.status, includeAwaitingReview)) return current;

    return new Promise<AgentSession>((resolve, reject) => {
      const waiter: SessionWaiter = {
        resolve,
        reject,
        includeAwaitingReview,
      };
      if (options.timeoutMs && options.timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          this.removeWaiter(sessionId, waiter);
          reject(new Error(`Timed out waiting for session ${sessionId} after ${options.timeoutMs}ms.`));
        }, options.timeoutMs);
      }
      const set = this.waiters.get(sessionId) ?? new Set<SessionWaiter>();
      set.add(waiter);
      this.waiters.set(sessionId, set);
    });
  }

  async cancelSession(sessionId: string, reason = "cancelled by caller"): Promise<AgentSession> {
    const controller = this.controllers.get(sessionId);
    if (controller) controller.abort();

    const queuedIndex = this.queue.indexOf(sessionId);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
      const queued = await this.mustGetSession(sessionId);
      queued.status = "cancelled";
      queued.error = reason;
      queued.endedAt = nowIso(this.clock);
      this.touch(queued);
      this.appendAudit(queued, "session.cancelled", { reason });
      await this.saveAndNotify(queued);
      return queued;
    }

    const session = await this.mustGetSession(sessionId);
    if (TERMINAL_STATUSES.has(session.status)) return session;
    if (session.status === "awaiting_review") {
      session.status = "cancelled";
      session.error = reason;
      session.endedAt = nowIso(this.clock);
      this.touch(session);
      this.appendAudit(session, "session.cancelled", { reason });
      await this.saveAndNotify(session);
    }
    return session;
  }

  async submitReview(
    sessionId: string,
    decision: Omit<ReviewDecisionRecord, "id" | "sessionId" | "requestedAt">,
  ): Promise<AgentSession> {
    const session = await this.mustGetSession(sessionId);
    if (session.status !== "awaiting_review") {
      throw new Error(`Session ${sessionId} is not awaiting review.`);
    }
    if (!this.reviewGate.submitReview) {
      throw new Error("Review gate does not support submitReview().");
    }

    const review = await this.instrument("review.resolve", session, {
      decisionStatus: decision.status,
      reviewer: decision.reviewer,
    }, () => this.reviewGate.submitReview!(sessionId, decision));
    session.review = review;
    this.appendAudit(session, "review.resolved", { status: review.status, reviewer: review.reviewer });

    if (review.status === "approved") {
      session.status = "completed";
      session.endedAt = nowIso(this.clock);
      this.appendAudit(session, "session.completed");
    } else if (review.status === "pending") {
      session.status = "awaiting_review";
    } else {
      session.status = "failed";
      session.error = review.notes ?? `Review ${review.status}`;
      session.endedAt = nowIso(this.clock);
      this.appendAudit(session, "session.failed", { reason: session.error });
    }
    this.touch(session);
    await this.saveAndNotify(session);
    return session;
  }

  private dispatch(): void {
    while (
      this.active.size < this.capacity.maxConcurrentSessions &&
      this.queue.length > 0
    ) {
      const sessionId = this.queue.shift()!;
      this.active.add(sessionId);
      void this.executeSession(sessionId).finally(() => {
        this.active.delete(sessionId);
        this.controllers.delete(sessionId);
        this.dispatch();
      });
    }
  }

  private async executeSession(sessionId: string): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(sessionId, controller);

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let session = await this.mustGetSession(sessionId);

    try {
      session.status = "provisioning";
      this.touch(session);
      await this.saveAndNotify(session);

      const route = await this.instrument("routing", session, {
        triggerKind: session.trigger.kind,
        triggerSource: session.trigger.source,
      }, () => this.router.route(session.task, session.trigger));
      session.route = route;
      session.priority = route.priority ?? session.priority;
      this.appendAudit(session, "session.routed", {
        agentId: route.agentId,
        runtime: route.runtime,
        provider: route.provider,
      });

      const timeoutMs = this.resolveTimeout(route);
      if (timeoutMs > 0) {
        timeout = setTimeout(() => controller.abort(), timeoutMs);
      }

      const environment = await this.instrument("environment.provision", session, {
        agentId: route.agentId,
        runtime: route.runtime,
        provider: route.provider,
        environmentSize: route.environmentSize,
      }, () => this.environmentProvider.provision({
        sessionId,
        task: session.task,
        trigger: session.trigger,
        route,
      }));
      session.environment = environment;
      this.appendAudit(session, "environment.provisioned", { environmentId: environment.id });

      const identity = await this.instrument("identity.issue", session, {
        environmentId: environment.id,
      }, () => this.identityProvider.issueIdentity({
        sessionId,
        task: session.task,
        trigger: session.trigger,
        route,
        environment,
      }));
      session.identity = identity;
      this.appendAudit(session, "identity.issued", { identityId: identity.id, scopes: identity.scopes });

      const capabilityGrant = await this.instrument("capability.grant", session, {
        identityId: identity.id,
      }, () => this.capabilityBroker.grant({
        sessionId,
        task: session.task,
        trigger: session.trigger,
        route,
        environment,
        identity,
      }));
      session.capabilityGrant = capabilityGrant;
      this.appendAudit(session, "capability.granted", {
        grantId: capabilityGrant.id,
        count: capabilityGrant.capabilities.length,
        capabilities: capabilityGrant.capabilities.map(summarizeCapability),
      });

      session.status = "running";
      session.startedAt = nowIso(this.clock);
      this.touch(session);
      this.appendAudit(session, "session.running");
      await this.saveAndNotify(session);

      const outcome = await this.instrument("runner.execute", session, {
        agentId: route.agentId,
        runtime: route.runtime,
        provider: route.provider,
      }, () => this.runner.run({
        session: cloneRecord(session),
        task: session.task,
        trigger: session.trigger,
        route,
        environment,
        identity,
        capabilityGrant,
        signal: controller.signal,
      }));

      if (controller.signal.aborted) {
        throw new Error("Session cancelled.");
      }

      session = await this.mustGetSession(sessionId);
      await this.applyOutcome(session, outcome);
      await this.releaseRuntimeResources(session, "agent run finished");

      if (outcome.status === "failed") {
        session.status = "failed";
        session.error = outcome.error ?? outcome.summary;
        session.endedAt = nowIso(this.clock);
        this.appendAudit(session, "session.failed", { reason: session.error });
      } else if (session.task.review?.required) {
        await this.requestReview(session);
      } else {
        session.status = "completed";
        session.endedAt = nowIso(this.clock);
        this.appendAudit(session, "session.completed");
      }

      this.touch(session);
      await this.saveAndNotify(session);
    } catch (error) {
      session = await this.mustGetSession(sessionId);
      await this.releaseRuntimeResources(session, "session failed");
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof Error && error.name === "PlatformPolicyError") {
        this.appendAudit(session, "policy.denied", { reason: message });
      }
      if (controller.signal.aborted) {
        session.status = "cancelled";
        session.error = "Session cancelled.";
        this.appendAudit(session, "session.cancelled", { reason: message });
      } else {
        session.status = "failed";
        session.error = message;
        this.appendAudit(session, "session.failed", { reason: message });
      }
      session.endedAt = nowIso(this.clock);
      this.touch(session);
      await this.saveAndNotify(session);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async applyOutcome(session: AgentSession, outcome: AgentRunOutcome): Promise<void> {
    session.result = outcome.summary;
    session.telemetry = outcome.telemetry;
    if (
      outcome.telemetry?.costUsd !== undefined &&
      outcome.telemetry.costUsd > this.capacity.maxCostUsdPerSession
    ) {
      this.appendAudit(session, "budget.warning", {
        costUsd: outcome.telemetry.costUsd,
        limit: this.capacity.maxCostUsdPerSession,
      });
    }

    const artifacts = outcome.artifacts && outcome.artifacts.length > 0
      ? outcome.artifacts
      : [{
          type: outcome.status === "failed" ? "failed_run_diagnosis" : "report",
          title: outcome.status === "failed" ? "Failed run diagnosis" : "Agent run report",
          content: outcome.error ? `${outcome.summary}\n\n${outcome.error}` : outcome.summary,
        } satisfies OutputArtifactInput];

    for (const artifactInput of artifacts) {
      let artifact = this.normalizeArtifact(session.id, artifactInput);
      session.artifacts.push(artifact);
      const published = await this.instrument("artifact.publish", session, {
        artifactId: artifact.id,
        artifactType: artifact.type,
      }, () => this.artifactStore.put(artifact));
      if (published) {
        artifact = published;
        session.artifacts[session.artifacts.length - 1] = published;
      }
      this.appendAudit(session, "artifact.created", {
        artifactId: artifact.id,
        type: artifact.type,
        uri: artifact.uri,
      });
    }
  }

  private async requestReview(session: AgentSession): Promise<void> {
    const route = session.route;
    if (!route) throw new Error("Cannot request review before routing.");

    const review = await this.instrument("review.request", session, {
      reviewers: session.task.review?.reviewers ?? [],
    }, () => this.reviewGate.requestReview({
      sessionId: session.id,
      task: session.task,
      trigger: session.trigger,
      route,
      artifacts: session.artifacts,
      reviewers: session.task.review?.reviewers ?? [],
    }));

    session.review = review;
    this.appendAudit(session, "review.requested", {
      status: review.status,
      reviewers: session.task.review?.reviewers ?? [],
    });

    if (review.status === "pending") {
      session.status = "awaiting_review";
    } else if (review.status === "approved") {
      session.status = "completed";
      session.endedAt = nowIso(this.clock);
      this.appendAudit(session, "session.completed");
    } else {
      session.status = "failed";
      session.error = review.notes ?? `Review ${review.status}`;
      session.endedAt = nowIso(this.clock);
      this.appendAudit(session, "session.failed", { reason: session.error });
    }
  }

  private async releaseRuntimeResources(session: AgentSession, reason: string): Promise<void> {
    await this.instrument("resource.release", session, { reason }, async () => {
      if (session.capabilityGrant?.status === "active") {
        await this.instrument("capability.revoke", session, {
          grantId: session.capabilityGrant.id,
        }, () => this.capabilityBroker.revoke(session.capabilityGrant!, reason));
        session.capabilityGrant = {
          ...session.capabilityGrant,
          status: "revoked",
          revokedAt: nowIso(this.clock),
        };
        this.appendAudit(session, "capability.revoked", { grantId: session.capabilityGrant.id });
      }
      if (session.identity && !session.identity.revokedAt) {
        await this.instrument("identity.revoke", session, {
          identityId: session.identity.id,
        }, () => this.identityProvider.revokeIdentity?.(session.identity!, reason));
        session.identity = { ...session.identity, revokedAt: nowIso(this.clock) };
        this.appendAudit(session, "identity.revoked", { identityId: session.identity.id });
      }
      if (session.environment && session.environment.status !== "released") {
        await this.instrument("environment.release", session, {
          environmentId: session.environment.id,
        }, () => this.environmentProvider.release(session.environment!, reason));
        session.environment = {
          ...session.environment,
          status: "released",
          releasedAt: nowIso(this.clock),
          updatedAt: nowIso(this.clock),
        };
        this.appendAudit(session, "environment.released", { environmentId: session.environment.id });
      }
    });
  }

  private normalizeArtifact(sessionId: string, input: OutputArtifactInput): OutputArtifact {
    return {
      ...input,
      id: input.id ?? this.idFactory("art"),
      sessionId,
      createdAt: nowIso(this.clock),
    };
  }

  private resolveTimeout(route: RouteDecision): number {
    const routeTimeout = route.timeoutMs ?? 0;
    const defaultTimeout = this.capacity.defaultTimeoutMs;
    const maxTimeout = this.capacity.maxSessionMs;
    const selected = routeTimeout > 0 ? routeTimeout : defaultTimeout;
    if (maxTimeout > 0 && selected > 0) return Math.min(selected, maxTimeout);
    return selected;
  }

  private appendAudit(
    session: AgentSession,
    type: PlatformAuditEventType,
    data?: Record<string, unknown>,
  ): void {
    const event: PlatformAuditEvent = {
      id: this.idFactory("evt"),
      type,
      timestamp: nowIso(this.clock),
      sessionId: session.id,
      actor: session.trigger.actor,
      data,
    };
    session.audit.push(event);
  }

  private touch(session: AgentSession): void {
    session.updatedAt = nowIso(this.clock);
  }

  private async saveAndNotify(session: AgentSession): Promise<void> {
    await this.sessionStore.save(session);
    this.notifyWaiters(session);
  }

  private async mustGetSession(sessionId: string): Promise<AgentSession> {
    const session = await this.sessionStore.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    return session;
  }

  private notifyWaiters(session: AgentSession): void {
    const waiters = this.waiters.get(session.id);
    if (!waiters) return;

    for (const waiter of [...waiters]) {
      if (!isSettled(session.status, waiter.includeAwaitingReview)) continue;
      this.removeWaiter(session.id, waiter);
      waiter.resolve(cloneRecord(session));
    }
  }

  private removeWaiter(sessionId: string, waiter: SessionWaiter): void {
    if (waiter.timer) clearTimeout(waiter.timer);
    const set = this.waiters.get(sessionId);
    if (!set) return;
    set.delete(waiter);
    if (set.size === 0) this.waiters.delete(sessionId);
  }
}
