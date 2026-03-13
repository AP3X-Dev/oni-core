import type { TokenUsage } from "../models/types.js";

export interface AgentStartEvent {
  type: "agent.start";
  agent: string;
  timestamp: number;
  step: number;
}

export interface AgentEndEvent {
  type: "agent.end";
  agent: string;
  timestamp: number;
  step: number;
  duration: number;
  usage?: TokenUsage;
}

export interface LLMRequestEvent {
  type: "llm.request";
  agent: string;
  model: string;
  timestamp: number;
  messageCount: number;
  hasTools: boolean;
}

export interface LLMResponseEvent {
  type: "llm.response";
  agent: string;
  model: string;
  timestamp: number;
  duration: number;
  usage: TokenUsage;
  stopReason: string;
  hasToolCalls: boolean;
}

export interface ToolCallEvent {
  type: "tool.call";
  agent: string;
  tool: string;
  timestamp: number;
  input: Record<string, unknown>;
}

export interface ToolResultEvent {
  type: "tool.result";
  agent: string;
  tool: string;
  timestamp: number;
  duration: number;
  status: "success" | "error";
  output?: unknown;
  error?: string;
}

export interface HandoffEvent {
  type: "handoff";
  from: string;
  to: string;
  timestamp: number;
  message?: string;
}

export interface FilterBlockedEvent {
  type: "filter.blocked";
  filter: string;
  agent: string;
  direction: "input" | "output";
  reason: string;
  timestamp: number;
}

export interface BudgetWarningEvent {
  type: "budget.warning";
  agent: string;
  percentUsed: number;
  metric: string;
  timestamp: number;
}

export interface ErrorEvent {
  type: "error";
  agent?: string;
  error: Error;
  timestamp: number;
}

// ── Permission events ───────────────────────────────────────────

export interface PermissionAskedEvent {
  type: "permission.asked";
  toolName: string;
  input: Record<string, unknown>;
  agentName: string;
  timestamp: number;
}

export interface PermissionRepliedEvent {
  type: "permission.replied";
  toolName: string;
  decision: "allow" | "deny" | "always";
  timestamp: number;
}

// ── Session lifecycle events ────────────────────────────────────

export interface SessionCreatedEvent {
  type: "session.created";
  sessionId: string;
  agentName: string;
  timestamp: number;
}

export interface SessionCompletedEvent {
  type: "session.completed";
  sessionId: string;
  reason: string;
  turns: number;
  timestamp: number;
}

export interface SessionCompactingEvent {
  type: "session.compacting";
  sessionId: string;
  estimatedTokens?: number;
  messageCount?: number;
  threshold?: number;
  maxTokens?: number;
  percentUsed?: number;
  timestamp: number;
}

export interface SessionCompactedEvent {
  type: "session.compacted";
  sessionId: string;
  beforeCount: number;
  afterCount: number;
  summarized: boolean;
  estimatedTokensBefore?: number;
  estimatedTokensAfter?: number;
  threshold?: number;
  maxTokens?: number;
  percentUsedBefore?: number;
  percentUsedAfter?: number;
  failed?: boolean;
  error?: string;
  timestamp: number;
}

export interface SessionUpdatedEvent {
  type: "session.updated";
  sessionId: string;
  turn: number;
  tokenUsage: TokenUsage;
  timestamp: number;
}

// ── Swarm lifecycle events ──────────────────────────────────────

export interface SwarmStartedEvent {
  type: "swarm.started";
  swarmId?: string;
  topology?: string;
  agentCount?: number;
  timestamp: number;
}

export interface SwarmCompletedEvent {
  type: "swarm.completed";
  swarmId?: string;
  topology?: string;
  agentCount?: number;
  duration?: number;
  durationMs?: number;
  outcome?: string;
  agentResults?: Record<string, unknown>;
  timestamp: number;
}

export interface SwarmAgentStartedEvent {
  type: "swarm.agent.started";
  swarmId: string;
  agentName: string;
  agentRole?: string;
  timestamp: number;
}

export interface SwarmAgentCompletedEvent {
  type: "swarm.agent.completed";
  swarmId: string;
  agentName: string;
  agentRole?: string;
  durationMs: number;
  timestamp: number;
}

export interface SwarmAgentFailedEvent {
  type: "swarm.agent.failed";
  swarmId: string;
  agentName: string;
  agentRole?: string;
  error: string;
  timestamp: number;
}

// ── Inference events ────────────────────────────────────────────

export interface InferenceRetryEvent {
  type: "inference.retry";
  attempt: number;
  maxRetries: number;
  delayMs: number;
  error: string;
  timestamp: number;
}

// ── Cron events ─────────────────────────────────────────────────

export interface CronFiredEvent {
  type: "cron.fired";
  jobId: string;
  prompt: string;
  timestamp: number;
}

// ── File events ─────────────────────────────────────────────────

export interface FileChangedEvent {
  type: "file.changed";
  path: string;
  changeType: string;
  timestamp: number;
  agentInitiated?: boolean;
  [key: string]: unknown;
}

// ── Union ───────────────────────────────────────────────────────

export type LifecycleEvent =
  | AgentStartEvent
  | AgentEndEvent
  | LLMRequestEvent
  | LLMResponseEvent
  | ToolCallEvent
  | ToolResultEvent
  | HandoffEvent
  | FilterBlockedEvent
  | BudgetWarningEvent
  | ErrorEvent
  | PermissionAskedEvent
  | PermissionRepliedEvent
  | SessionCreatedEvent
  | SessionCompletedEvent
  | SessionCompactingEvent
  | SessionCompactedEvent
  | SessionUpdatedEvent
  | SwarmStartedEvent
  | SwarmCompletedEvent
  | SwarmAgentStartedEvent
  | SwarmAgentCompletedEvent
  | SwarmAgentFailedEvent
  | InferenceRetryEvent
  | CronFiredEvent
  | FileChangedEvent;

export type EventType = LifecycleEvent["type"];

export type EventHandler<T extends LifecycleEvent = LifecycleEvent> = (event: T) => void;

export type EventListeners = {
  [K in EventType]?: EventHandler<Extract<LifecycleEvent, { type: K }>>;
};
