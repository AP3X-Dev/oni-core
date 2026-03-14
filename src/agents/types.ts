// ============================================================
// @oni.bot/core — Agent Types
// ============================================================
// Defines the type contracts for both declarative (defineAgent)
// and functional (agent) agent factories.
// ============================================================

import type {
  ONIModel,
  ONIModelMessage,
  ChatResponse,
  ChatChunk,
  ToolResult,
} from "../models/types.js";
import type { ToolDefinition } from "../tools/types.js";
import type { ONIConfig } from "../types.js";
import type { BaseStore } from "../store/index.js";
import type { StreamWriter } from "../context.js";

// ----------------------------------------------------------------
// SwarmMessageView — what agents see in their inbox
// ----------------------------------------------------------------

export interface SwarmMessageView {
  id: string;
  from: string;
  content: unknown;
  timestamp: number;
  replyTo?: string;
  /** Internal: channel used by reply() — not part of public API contract */
  _replyChannel?: (payload: unknown) => void;
}

// ----------------------------------------------------------------
// AgentContext<S> — what functional agents receive
// ----------------------------------------------------------------

export interface AgentContext<S = Record<string, unknown>> {
  // ---- LLM interaction ----
  chat(messages: ONIModelMessage[]): Promise<ChatResponse>;
  stream(messages: ONIModelMessage[]): AsyncGenerator<ChatChunk>;
  executeTools(calls: Array<{ id: string; name: string; args: Record<string, unknown> }>): Promise<ToolResult[]>;

  // ---- Coordination ----
  send(agent: string, payload: unknown): void;
  inbox(): SwarmMessageView[];
  /** @unsupported Throws at runtime — not yet wired. Reserved for a future release. */
  request(agent: string, payload: unknown): Promise<unknown>;
  reply(msg: SwarmMessageView, payload: unknown): void;
  /** @unsupported No-op at runtime — not yet wired. Reserved for a future release. */
  publish(topic: string, data: unknown): void;

  // ---- Runtime context ----
  config: ONIConfig;
  store: BaseStore | null;
  state: S;
  streamWriter: StreamWriter | null;
  remainingSteps: number;
  agentName: string;
}

// ----------------------------------------------------------------
// DefineAgentOptions — config for declarative agents
// ----------------------------------------------------------------

export interface DefineAgentOptions {
  name: string;
  description?: string;
  model: ONIModel;
  tools?: ToolDefinition[];
  systemPrompt?: string;
  maxSteps?: number;
  maxTokens?: number;
}

// ----------------------------------------------------------------
// FunctionalAgentOptions — options for agent() factory
// ----------------------------------------------------------------

export interface FunctionalAgentOptions {
  model?: ONIModel;
  tools?: ToolDefinition[];
  systemPrompt?: string;
  maxSteps?: number;
  maxTokens?: number;
}

// ----------------------------------------------------------------
// AgentNode — the compiled result of defineAgent() or agent()
// ----------------------------------------------------------------

export interface AgentNode<S = Record<string, unknown>> {
  name: string;
  description?: string;
  model?: ONIModel;
  tools: ToolDefinition[];
  systemPrompt?: string;
  maxSteps: number;
  maxTokens?: number;
  _nodeFn: (state: S, config?: ONIConfig) => Promise<Partial<S>>;
  _isAgent: true;
}
