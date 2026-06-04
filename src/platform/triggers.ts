// ============================================================
// @oni.bot/core/platform - Trigger adapters
// ============================================================
// Small adapters that normalize concrete launch surfaces into
// provider-neutral AgentTrigger records.
// ============================================================

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  AgentTrigger,
  TriggerKind,
  RepositoryRef,
} from "./types.js";

export interface PlatformTriggerAdapterOptions {
  clock?: () => Date;
  idFactory?: (prefix: string) => string;
}

export interface PlatformTriggerAdapter<TInput> {
  readonly kind: TriggerKind;
  toTrigger(input: TInput): AgentTrigger;
}

export interface CliTriggerInput {
  id?: string;
  command?: string;
  argv?: string[];
  flags?: Record<string, string | number | boolean | undefined>;
  cwd?: string;
  actor?: string;
  source?: string;
  firedAt?: string | Date;
  correlationId?: string;
  payload?: Record<string, unknown>;
}

export interface ScheduledTriggerInput {
  id?: string;
  scheduleId: string;
  scheduledFor?: string | Date;
  timezone?: string;
  actor?: string;
  source?: string;
  firedAt?: string | Date;
  correlationId?: string;
  payload?: Record<string, unknown>;
}

export interface GitHubWebhookTriggerInput {
  id?: string;
  event: string;
  payload: Record<string, unknown>;
  deliveryId?: string;
  signature256?: string;
  secret?: string;
  rawBody?: string | Uint8Array;
  actor?: string;
  source?: string;
  firedAt?: string | Date;
  correlationId?: string;
}

export interface ChatCommandTriggerInput {
  id?: string;
  provider: string;
  text: string;
  command?: string;
  channelId?: string;
  channelName?: string;
  userId?: string;
  username?: string;
  threadId?: string;
  messageId?: string;
  actor?: string;
  source?: string;
  firedAt?: string | Date;
  correlationId?: string;
  payload?: Record<string, unknown>;
}

export interface DependencyAlertTriggerInput {
  id?: string;
  provider: string;
  packageName: string;
  ecosystem?: string;
  severity?: "low" | "moderate" | "medium" | "high" | "critical" | string;
  advisoryId?: string;
  cve?: string;
  affectedRange?: string;
  fixedVersion?: string;
  manifestPath?: string;
  repository?: RepositoryRef;
  url?: string;
  actor?: string;
  source?: string;
  firedAt?: string | Date;
  correlationId?: string;
  payload?: Record<string, unknown>;
}

function defaultId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function toIso(value: string | Date | undefined, clock: () => Date): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return clock().toISOString();
}

function cleanPayload(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const cleaned = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  );
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function senderLogin(payload: Record<string, unknown>): string | undefined {
  return asString(asRecord(payload.sender)?.login);
}

function githubRepository(payload: Record<string, unknown>): RepositoryRef | undefined {
  const repo = asRecord(payload.repository);
  if (!repo) return undefined;
  const owner = asRecord(repo.owner);
  return cleanPayload({
    provider: "github",
    owner: asString(owner?.login) ?? asString(owner?.name),
    name: asString(repo.name),
    url: asString(repo.html_url) ?? asString(repo.url),
    ref: asString(payload.ref),
  }) as RepositoryRef | undefined;
}

function githubEventKind(event: string): TriggerKind {
  if (
    event === "dependabot_alert" ||
    event === "repository_vulnerability_alert" ||
    event === "security_advisory" ||
    event === "code_scanning_alert" ||
    event === "secret_scanning_alert"
  ) {
    return "security";
  }
  if (
    event === "pull_request" ||
    event === "pull_request_review" ||
    event === "pull_request_review_comment" ||
    event === "push" ||
    event === "issues" ||
    event === "issue_comment" ||
    event === "workflow_run"
  ) {
    return "vcs";
  }
  return "webhook";
}

function githubPayloadSummary(
  event: string,
  payload: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const pullRequest = asRecord(payload.pull_request);
  const issue = asRecord(payload.issue);
  const alert = asRecord(payload.alert) ?? asRecord(payload.dependabot_alert);
  return cleanPayload({
    event,
    action: asString(payload.action),
    repository: githubRepository(payload),
    ref: asString(payload.ref),
    before: asString(payload.before),
    after: asString(payload.after),
    sender: senderLogin(payload),
    pullRequestNumber: asNumber(pullRequest?.number),
    pullRequestUrl: asString(pullRequest?.html_url),
    issueNumber: asNumber(issue?.number),
    issueUrl: asString(issue?.html_url),
    alertNumber: asNumber(alert?.number),
    alertUrl: asString(alert?.html_url),
  });
}

export function verifyGitHubWebhookSignature(input: {
  secret: string;
  rawBody: string | Uint8Array;
  signature256: string;
}): void {
  if (!input.secret) {
    throw new Error("GitHub webhook secret is required.");
  }
  const expected = createHmac("sha256", input.secret)
    .update(input.rawBody)
    .digest("hex");
  const actual = input.signature256.startsWith("sha256=")
    ? input.signature256.slice("sha256=".length)
    : input.signature256;
  if (!/^[a-f0-9]{64}$/i.test(actual)) {
    throw new Error("Invalid GitHub webhook signature format.");
  }
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");
  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    throw new Error("GitHub webhook signature mismatch.");
  }
}

function triggerId(
  inputId: string | undefined,
  options: PlatformTriggerAdapterOptions,
): string {
  return inputId ?? (options.idFactory ?? defaultId)("trg");
}

export function createCliTrigger(
  input: CliTriggerInput = {},
  options: PlatformTriggerAdapterOptions = {},
): AgentTrigger {
  const clock = options.clock ?? (() => new Date());
  return {
    id: triggerId(input.id, options),
    kind: "manual",
    source: input.source ?? "cli",
    actor: input.actor,
    firedAt: toIso(input.firedAt, clock),
    correlationId: input.correlationId,
    payload: cleanPayload({
      command: input.command,
      argv: input.argv,
      flags: input.flags,
      cwd: input.cwd,
      ...(input.payload ?? {}),
    }),
  };
}

export function createScheduledTrigger(
  input: ScheduledTriggerInput,
  options: PlatformTriggerAdapterOptions = {},
): AgentTrigger {
  const clock = options.clock ?? (() => new Date());
  return {
    id: triggerId(input.id, options),
    kind: "schedule",
    source: input.source ?? `schedule:${input.scheduleId}`,
    actor: input.actor ?? "scheduler",
    firedAt: toIso(input.firedAt, clock),
    correlationId: input.correlationId,
    payload: cleanPayload({
      scheduleId: input.scheduleId,
      scheduledFor: input.scheduledFor instanceof Date
        ? input.scheduledFor.toISOString()
        : input.scheduledFor,
      timezone: input.timezone,
      ...(input.payload ?? {}),
    }),
  };
}

export function createGitHubWebhookTrigger(
  input: GitHubWebhookTriggerInput,
  options: PlatformTriggerAdapterOptions = {},
): AgentTrigger {
  if (input.secret) {
    if (!input.rawBody || !input.signature256) {
      throw new Error("GitHub webhook verification requires rawBody and signature256.");
    }
    verifyGitHubWebhookSignature({
      secret: input.secret,
      rawBody: input.rawBody,
      signature256: input.signature256,
    });
  }
  const clock = options.clock ?? (() => new Date());
  const event = input.event.trim();
  if (!event) {
    throw new Error("GitHub webhook event is required.");
  }
  return {
    id: triggerId(input.id, options),
    kind: githubEventKind(event),
    source: input.source ?? `github.${event}`,
    actor: input.actor ?? senderLogin(input.payload),
    firedAt: toIso(input.firedAt, clock),
    correlationId: input.correlationId ?? input.deliveryId,
    payload: githubPayloadSummary(event, input.payload),
  };
}

export function createChatCommandTrigger(
  input: ChatCommandTriggerInput,
  options: PlatformTriggerAdapterOptions = {},
): AgentTrigger {
  const clock = options.clock ?? (() => new Date());
  return {
    id: triggerId(input.id, options),
    kind: "chat",
    source: input.source ?? `chat:${input.provider}`,
    actor: input.actor ?? input.username ?? input.userId,
    firedAt: toIso(input.firedAt, clock),
    correlationId: input.correlationId ?? input.messageId,
    payload: cleanPayload({
      provider: input.provider,
      command: input.command,
      text: input.text,
      channelId: input.channelId,
      channelName: input.channelName,
      userId: input.userId,
      username: input.username,
      threadId: input.threadId,
      messageId: input.messageId,
      ...(input.payload ?? {}),
    }),
  };
}

export function createDependencyAlertTrigger(
  input: DependencyAlertTriggerInput,
  options: PlatformTriggerAdapterOptions = {},
): AgentTrigger {
  const clock = options.clock ?? (() => new Date());
  return {
    id: triggerId(input.id, options),
    kind: "dependency",
    source: input.source ?? `dependency:${input.provider}`,
    actor: input.actor ?? input.provider,
    firedAt: toIso(input.firedAt, clock),
    correlationId: input.correlationId ?? input.advisoryId ?? input.cve,
    payload: cleanPayload({
      provider: input.provider,
      packageName: input.packageName,
      ecosystem: input.ecosystem,
      severity: input.severity,
      advisoryId: input.advisoryId,
      cve: input.cve,
      affectedRange: input.affectedRange,
      fixedVersion: input.fixedVersion,
      manifestPath: input.manifestPath,
      repository: input.repository,
      url: input.url,
      ...(input.payload ?? {}),
    }),
  };
}

export class CliTriggerAdapter implements PlatformTriggerAdapter<CliTriggerInput> {
  readonly kind = "manual" as const;

  constructor(private readonly options: PlatformTriggerAdapterOptions = {}) {}

  toTrigger(input: CliTriggerInput): AgentTrigger {
    return createCliTrigger(input, this.options);
  }
}

export class ScheduledTriggerAdapter implements PlatformTriggerAdapter<ScheduledTriggerInput> {
  readonly kind = "schedule" as const;

  constructor(private readonly options: PlatformTriggerAdapterOptions = {}) {}

  toTrigger(input: ScheduledTriggerInput): AgentTrigger {
    return createScheduledTrigger(input, this.options);
  }
}

export class GitHubWebhookTriggerAdapter implements PlatformTriggerAdapter<GitHubWebhookTriggerInput> {
  readonly kind = "webhook" as const;

  constructor(private readonly options: PlatformTriggerAdapterOptions = {}) {}

  toTrigger(input: GitHubWebhookTriggerInput): AgentTrigger {
    return createGitHubWebhookTrigger(input, this.options);
  }
}

export class ChatCommandTriggerAdapter implements PlatformTriggerAdapter<ChatCommandTriggerInput> {
  readonly kind = "chat" as const;

  constructor(private readonly options: PlatformTriggerAdapterOptions = {}) {}

  toTrigger(input: ChatCommandTriggerInput): AgentTrigger {
    return createChatCommandTrigger(input, this.options);
  }
}

export class DependencyAlertTriggerAdapter implements PlatformTriggerAdapter<DependencyAlertTriggerInput> {
  readonly kind = "dependency" as const;

  constructor(private readonly options: PlatformTriggerAdapterOptions = {}) {}

  toTrigger(input: DependencyAlertTriggerInput): AgentTrigger {
    return createDependencyAlertTrigger(input, this.options);
  }
}
