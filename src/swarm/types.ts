// ============================================================
// @oni.bot/core/swarm — Swarm Types
// ============================================================

import type { ONISkeleton } from "../types.js";
import type { ONIModel } from "../models/types.js";

// ----------------------------------------------------------------
// Agent Identity & Role
// ----------------------------------------------------------------

export type AgentStatus = "idle" | "busy" | "terminated" | "error";

export interface AgentCapability {
  name:        string;
  description: string;
  /** Examples of inputs this agent handles well */
  examples?:   string[];
}

export interface SwarmAgentDef<S extends Record<string, unknown> = Record<string, unknown>> {
  /** Unique ID within the swarm */
  id:               string;
  /** Human-readable role label */
  role:             string;
  /** Describes what this agent can handle — used by Supervisor for routing */
  capabilities:     AgentCapability[];
  /** The compiled skeleton backing this agent */
  skeleton:         ONISkeleton<S>;
  /** Max simultaneous executions (default: 1) */
  maxConcurrency?:  number;
  /** System prompt injected into routing context */
  systemPrompt?:    string;
  /** Max retries before fallback to supervisor (default: 2) */
  maxRetries?:      number;
  /** Per-agent execution timeout in ms */
  timeout?:         number;
  /** Delay between retries in ms (default: 0 = no delay) */
  retryDelayMs?:    number;
  /** Lifecycle hooks for this agent */
  hooks?:           AgentLifecycleHooks;
}

// ----------------------------------------------------------------
// Structured agent error context — passed to supervisor via state.context
// ----------------------------------------------------------------

export interface AgentErrorContext {
  agent:      string;
  error:      string;
  type:       "model_error" | "tool_error" | "timeout" | "unknown";
  attempt:    number;
  maxRetries: number;
}

// ----------------------------------------------------------------
// Handoff — the core inter-agent communication primitive
// ----------------------------------------------------------------

export interface HandoffOptions {
  /** Target agent ID to hand off to */
  to:       string;
  /** Human-readable instruction for the receiving agent */
  message:  string;
  /** Additional context merged into the receiving agent's input */
  context?: Record<string, unknown>;
  /**
   * Which agent to return to after the target completes.
   * If omitted, control returns to the Supervisor (if present) or END.
   */
  resume?:  string;
  /** Priority hint for the AgentPool scheduler */
  priority?: "low" | "normal" | "high" | "critical";
}

export class Handoff {
  readonly isHandoff = true;
  constructor(public readonly opts: HandoffOptions) {}

  get to():       string  { return this.opts.to; }
  get message():  string  { return this.opts.message; }
  get context():  Record<string, unknown> | undefined { return this.opts.context; }
  get resume():   string | undefined { return this.opts.resume; }
  get priority(): string  { return this.opts.priority ?? "normal"; }
}

// ----------------------------------------------------------------
// SwarmMessage — async mailbox message between agents
// ----------------------------------------------------------------

export interface SwarmMessage {
  id:        string;
  from:      string;       // sender agent ID
  to:        string;       // recipient agent ID ("*" = broadcast)
  content:   string;
  metadata?: Record<string, unknown>;
  timestamp: number;
  replyTo?:  string;       // message ID to reply to
}

// ----------------------------------------------------------------
// Handoff record — audit trail of all handoffs in a swarm run
// ----------------------------------------------------------------

export interface HandoffRecord {
  from:      string;
  to:        string;
  message:   string;
  step:      number;
  timestamp: number;
  resume?:   string;
}

// ----------------------------------------------------------------
// Swarm metadata channel — lives in shared blackboard
// ----------------------------------------------------------------

export interface SwarmMeta {
  activeAgents:    string[];
  completedAgents: string[];
  handoffHistory:  HandoffRecord[];
  messages:        SwarmMessage[];
  currentAgent?:   string;
  supervisorRound: number;
}

// ----------------------------------------------------------------
// Supervisor routing
// ----------------------------------------------------------------

export type SupervisorRoutingStrategy = "llm" | "rule" | "round-robin" | "capability";

export interface RuleRoute {
  condition: (task: string, context: Record<string, unknown>) => boolean;
  agentId:   string;
}

export interface SupervisorConfig<S extends Record<string, unknown>> {
  /** ONIModel for LLM-based routing (required if strategy === "llm") */
  model?:     ONIModel;
  /** Routing strategy */
  strategy:   SupervisorRoutingStrategy;
  /** Rule-based routes (required if strategy === "rule") */
  rules?:     RuleRoute[];
  /** Field in state that contains the current task */
  taskField:  keyof S;
  /** Field in state that contains routing context */
  contextField?: keyof S;
  /** Max rounds before Supervisor sends to END */
  maxRounds?: number;
  /** System prompt for LLM-based routing */
  systemPrompt?: string;
  /** Whole-swarm deadline in ms, computed from invoke-time (not compile-time). */
  deadlineMs?: number;
  /** Auto-recover: when an agent errors, route to an idle agent with matching capability. */
  autoRecover?: boolean;
}

// ----------------------------------------------------------------
// AgentPool config
// ----------------------------------------------------------------

export interface AgentPoolConfig<S extends Record<string, unknown>> {
  /** Agents in the pool — all handle the same task type */
  agents:        SwarmAgentDef<S>[];
  /** Load balancing strategy */
  strategy?:     "round-robin" | "least-busy" | "random";
  /** Max queue depth before backpressure kicks in */
  maxQueueDepth?: number;
}

// ----------------------------------------------------------------
// Swarm topology type tag
// ----------------------------------------------------------------

export type SwarmTopology =
  | "hierarchical"     // Supervisor → Workers → Supervisor
  | "peer-to-peer"     // Agents hand off directly
  | "pipeline"         // Linear: A → B → C
  | "hierarchical-mesh" // Supervisors over peer networks
  | "custom";

// ----------------------------------------------------------------
// Agent lifecycle hooks for swarm-runner
// ----------------------------------------------------------------

export interface AgentLifecycleHooks {
  onStart?: (agentId: string, state?: Record<string, unknown>) => void | Promise<void>;
  onComplete?: (agentId: string, result?: unknown) => void | Promise<void>;
  onError?: (agentId: string, error?: unknown) => void | Promise<void>;
}
