// ============================================================
// @oni.bot/core/harness — Types
// ============================================================

import type { ONIModel, ONIModelToolCall, ONIModelMessage } from "../models/types.js";
import type { ToolDefinition, ToolContext } from "../tools/types.js";

// ─── Extended ToolContext for harness ────────────────────────────────────────

export interface HarnessToolContext extends ToolContext {
  sessionId: string;
  threadId: string;
  agentName: string;
  turn: number;
  signal?: AbortSignal;
  /** Ask the user a question and wait for their response. */
  askUser?: (question: string) => Promise<string>;
  /** Stream metadata updates during tool execution (e.g. progress indicators). */
  metadata?: (update: { title?: string; metadata?: Record<string, unknown> }) => void;
}

// ─── Loop Message Protocol ───────────────────────────────────────────────────

export type LoopMessageType =
  | "system"
  | "user"
  | "assistant"
  | "tool_result"
  | "tool_start"
  | "tool_metadata"
  | "step_start"
  | "step_finish"
  | "result"
  | "error";

export interface LoopMessage {
  type: LoopMessageType;
  sessionId: string;
  turn: number;
  timestamp: number;
  content?: string;
  toolCalls?: ONIModelToolCall[];
  toolResults?: LoopToolResult[];
  subtype?: string;
  metadata?: Record<string, unknown>;
}

export interface LoopToolResult {
  toolCallId: string;
  toolName: string;
  content: string;
  isError?: boolean;
  durationMs?: number;
}

/** Metadata update streamed from a tool while it's executing. */
export interface ToolMetadataUpdate {
  [key: string]: unknown;
}

// ─── Session Outcome ──────────────────────────────────────────────────────────

export type SessionOutcome =
  | 'completed'       // agent reached END cleanly
  | 'budget-exceeded' // maxTurns hit; task may be incomplete
  | 'interrupted'     // abort signal fired
  | 'error';          // unhandled throw

// ─── Agent Loop Config ───────────────────────────────────────────────────────

export interface AgentLoopConfig {
  model: ONIModel;
  tools: ToolDefinition[];
  agentName: string;
  systemPrompt: string;
  maxTurns?: number;
  maxTokens?: number;
  threadId?: string;
  /** Prior conversation messages for multi-turn sessions */
  initialMessages?: ONIModelMessage[];
  todoModule?: import("./todo-module.js").TodoModule;
  hooksEngine?: import("./hooks-engine.js").HooksEngine;
  compactor?: import("./context-compactor.js").ContextCompactor;
  safetyGate?: import("./safety-gate.js").SafetyGate;
  skillLoader?: import("./skill-loader.js").SkillLoader;
  signal?: AbortSignal;
  /** Timeout for a single inference (LLM) call in milliseconds. */
  inferenceTimeoutMs?: number;
  /** Callback when the agent asks the user a question via the question tool. */
  onQuestion?: (question: string, resolve: (answer: string | null) => void) => void;
  /** Callback for streaming tool metadata updates. */
  onToolMetadata?: (toolCallId: string, toolName: string, update: ToolMetadataUpdate) => void;
  /** If set, only skills whose names are in this list will be loaded. */
  allowedSkills?: string[];
  env?: {
    cwd?: string;
    platform?: string;
    date?: string;
    gitBranch?: string;
    gitStatus?: string;
  };
  memoryRoot?: string;
  memoryBudgets?: Partial<Record<0 | 1 | 2 | 3, number>>;
  memoryDebug?: boolean;
  /** Message queue for injecting user messages into a running agent loop. Used by spawnAgent(). */
  messageQueue?: string[];
}

// ─── Harness Config ──────────────────────────────────────────────────────────

export interface HarnessConfig {
  model: ONIModel;
  fastModel?: ONIModel;
  sharedTools?: ToolDefinition[];
  soul?: string;
  hooks?: import("./hooks-engine.js").HooksConfig;
  compaction?: {
    threshold?: number;
    maxTokens?: number;
    charsPerToken?: number;
    compactInstructions?: string;
  };
  safety?: {
    protectedTools?: string[];
    safetySystemPrompt?: string;
    timeout?: number;
  };
  skillPaths?: string[];
  maxTurns?: number;
  maxTokens?: number;
  debug?: boolean;
  memoryRoot?: string;
  memoryBudgets?: Partial<Record<0 | 1 | 2 | 3, number>>;
  memoryDebug?: boolean;
  /** Optional ObjectiveManifest — loaded from MANIFEST.md, guides agent behavior */
  manifest?: import("../swarm/self-improvement/manifest.js").ObjectiveManifest;
}

export interface AgentNodeConfig {
  name: string;
  soul?: string;
  tools?: ToolDefinition[];
  maxTurns?: number;
  allowedSkills?: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
