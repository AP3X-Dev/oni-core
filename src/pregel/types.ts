// ============================================================
// src/pregel/types.ts — Internal shared interfaces
// ============================================================

import type {
  NodeDefinition, Edge, ChannelSchema,
  ONICheckpointer, InterruptConfig,
} from "../types.js";
import type { CircuitBreaker } from "../circuit-breaker.js";
import type { DeadLetterQueue } from "../dlq.js";
import type { BaseStore } from "../store/index.js";
import type { HITLSessionStore } from "../hitl/index.js";
import type { EventBus } from "../events/bus.js";
import type { ContentFilter } from "../guardrails/types.js";
import type { AuditLog } from "../guardrails/audit.js";
import type { BudgetTracker } from "../guardrails/budget.js";
import type { ONITracer } from "../telemetry.js";
import type { ToolPermissions } from "../tools/types.js";
import type { NodeReturn } from "../types.js";

export interface PregelContext<S extends Record<string, unknown>> {
  nodes: Map<string, NodeDefinition<S>>;
  edges: Edge<S>[];
  channels: ChannelSchema<S>;
  interruptConfig: InterruptConfig;
  checkpointer: ONICheckpointer<S> | null;
  store: BaseStore | null;
  circuitBreakers: Map<string, CircuitBreaker>;
  tracer: ONITracer;
  eventBus: EventBus;
  auditLog: AuditLog | null;
  budgetTracker: BudgetTracker | null;
  contentFilters: ContentFilter[];
  toolPermissions: ToolPermissions | undefined;
  dlq: DeadLetterQueue | null;
  hitlStore: HITLSessionStore<S>;
  defaults: { nodeTimeout?: number } | undefined;
  nodeCache: Map<string, { result: NodeReturn<S>; timestamp: number }>;
  _subgraphRef: { count: number };
  _perInvocationParentUpdates: Map<string, Array<Partial<unknown>>>;
  _perInvocationCheckpointer: Map<string, unknown>;
  _edgesBySource: Map<string, Edge<S>[]>;
  _ephemeralKeys: (keyof S)[];
}

export interface PendingSend {
  node: string;
  args: Record<string, unknown>;
}
