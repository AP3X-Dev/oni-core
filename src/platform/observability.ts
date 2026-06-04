// ============================================================
// @oni.bot/core/platform - Observability summaries
// ============================================================
// Pure helpers for turning session/audit records into operator-friendly
// health snapshots without requiring callers to parse raw platform state.
// ============================================================

import type {
  AgentSession,
  AgentSessionStatus,
  CapacityControls,
  PlatformAuditEvent,
  PlatformAuditEventType,
} from "./types.js";

const STATUSES: AgentSessionStatus[] = [
  "queued",
  "provisioning",
  "running",
  "awaiting_review",
  "completed",
  "failed",
  "cancelled",
];

const TERMINAL_STATUSES = new Set<AgentSessionStatus>([
  "completed",
  "failed",
  "cancelled",
]);

export interface PlatformSessionSummary {
  sessionId: string;
  taskId?: string;
  title: string;
  status: AgentSessionStatus;
  priority: AgentSession["priority"];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  costUsd?: number;
  artifactCount: number;
  auditEventCount: number;
}

export interface PlatformHealthSnapshot {
  generatedAt: string;
  totalSessions: number;
  queueDepth: number;
  activeSessions: number;
  statusCounts: Record<AgentSessionStatus, number>;
  terminalSessions: number;
  averageDurationMs?: number;
  failureRate: number;
  cancellationRate: number;
  costEstimateUsd: number;
  oldestQueuedAt?: string;
  oldestRunningStartedAt?: string;
  capacity?: Required<CapacityControls>;
  sessions: PlatformSessionSummary[];
}

export interface PlatformHealthSnapshotOptions {
  now?: Date;
  queueDepth?: number;
  activeSessionIds?: string[];
  capacity?: Required<CapacityControls>;
  includeSessions?: boolean;
}

export interface PlatformAuditSummary {
  generatedAt: string;
  totalEvents: number;
  byType: Partial<Record<PlatformAuditEventType, number>>;
  policyDenials: number;
  budgetWarnings: number;
  artifactEvents: number;
  reviewEvents: number;
  sessionsWithPolicyDenials: string[];
  latestEventAt?: string;
}

export interface PlatformAuditSummaryOptions {
  now?: Date;
  sessionId?: string;
  since?: string;
  type?: PlatformAuditEventType;
}

function statusCounts(): Record<AgentSessionStatus, number> {
  return Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<AgentSessionStatus, number>;
}

function parseTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function minIso(values: (string | undefined)[]): string | undefined {
  const valid = values.filter((value): value is string => !!value);
  if (valid.length === 0) return undefined;
  return valid.reduce((earliest, value) => (
    Date.parse(value) < Date.parse(earliest) ? value : earliest
  ));
}

function durationMs(session: AgentSession, nowMs: number): number | undefined {
  const started = parseTime(session.startedAt ?? session.createdAt);
  if (started === undefined) return undefined;
  const ended = parseTime(session.endedAt) ?? (TERMINAL_STATUSES.has(session.status)
    ? parseTime(session.updatedAt)
    : nowMs);
  if (ended === undefined) return undefined;
  return Math.max(0, ended - started);
}

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function eventIncluded(event: PlatformAuditEvent, options: PlatformAuditSummaryOptions): boolean {
  if (options.sessionId && event.sessionId !== options.sessionId) return false;
  if (options.type && event.type !== options.type) return false;
  if (options.since && Date.parse(event.timestamp) < Date.parse(options.since)) return false;
  return true;
}

export function summarizePlatformHealth(
  sessions: AgentSession[],
  options: PlatformHealthSnapshotOptions = {},
): PlatformHealthSnapshot {
  const generatedAt = (options.now ?? new Date()).toISOString();
  const nowMs = Date.parse(generatedAt);
  const counts = statusCounts();
  const summaries: PlatformSessionSummary[] = [];
  const finishedDurations: number[] = [];
  let costEstimateUsd = 0;

  for (const session of sessions) {
    counts[session.status] += 1;
    const duration = durationMs(session, nowMs);
    if (duration !== undefined && TERMINAL_STATUSES.has(session.status)) {
      finishedDurations.push(duration);
    }
    costEstimateUsd += session.telemetry?.costUsd ?? 0;
    summaries.push({
      sessionId: session.id,
      taskId: session.task.id,
      title: session.task.title,
      status: session.status,
      priority: session.priority,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      durationMs: duration,
      costUsd: session.telemetry?.costUsd,
      artifactCount: session.artifacts.length,
      auditEventCount: session.audit.length,
    });
  }

  const terminalSessions = counts.completed + counts.failed + counts.cancelled;
  const queueDepth = options.queueDepth ?? counts.queued;
  const activeSessions = options.activeSessionIds?.length ?? (counts.provisioning + counts.running);

  return {
    generatedAt,
    totalSessions: sessions.length,
    queueDepth,
    activeSessions,
    statusCounts: counts,
    terminalSessions,
    averageDurationMs: average(finishedDurations),
    failureRate: terminalSessions > 0 ? counts.failed / terminalSessions : 0,
    cancellationRate: terminalSessions > 0 ? counts.cancelled / terminalSessions : 0,
    costEstimateUsd,
    oldestQueuedAt: minIso(sessions.filter((session) => session.status === "queued").map((session) => session.createdAt)),
    oldestRunningStartedAt: minIso(sessions
      .filter((session) => session.status === "provisioning" || session.status === "running")
      .map((session) => session.startedAt ?? session.updatedAt)),
    capacity: options.capacity,
    sessions: options.includeSessions === false
      ? []
      : summaries.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
  };
}

export function summarizePlatformAudit(
  sessions: AgentSession[],
  options: PlatformAuditSummaryOptions = {},
): PlatformAuditSummary {
  const byType: Partial<Record<PlatformAuditEventType, number>> = {};
  const sessionsWithPolicyDenials = new Set<string>();
  let totalEvents = 0;
  let latestEventAt: string | undefined;

  for (const session of sessions) {
    for (const event of session.audit) {
      if (!eventIncluded(event, options)) continue;
      totalEvents += 1;
      byType[event.type] = (byType[event.type] ?? 0) + 1;
      if (event.type === "policy.denied" && event.sessionId) {
        sessionsWithPolicyDenials.add(event.sessionId);
      }
      if (!latestEventAt || Date.parse(event.timestamp) > Date.parse(latestEventAt)) {
        latestEventAt = event.timestamp;
      }
    }
  }

  return {
    generatedAt: (options.now ?? new Date()).toISOString(),
    totalEvents,
    byType,
    policyDenials: byType["policy.denied"] ?? 0,
    budgetWarnings: byType["budget.warning"] ?? 0,
    artifactEvents: byType["artifact.created"] ?? 0,
    reviewEvents: (byType["review.requested"] ?? 0) + (byType["review.resolved"] ?? 0),
    sessionsWithPolicyDenials: [...sessionsWithPolicyDenials].sort(),
    latestEventAt,
  };
}
