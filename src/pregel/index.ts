// ============================================================
// @oni.bot/core — Pregel Execution Engine v3
// New: interrupt() context management, HITL resume, token streaming
// ============================================================

import {
  type NodeDefinition, type Edge, type ChannelSchema,
  type ONIConfig, type ONIStreamEvent, type StreamMode, type InterruptConfig,
  type ONICheckpointer, type ONICheckpoint,
  type NodeReturn,
} from "../types.js";
import { CircuitBreaker } from "../circuit-breaker.js";
import { DeadLetterQueue, type DeadLetter } from "../dlq.js";
import type { BaseStore } from "../store/index.js";
import { HITLSessionStore } from "../hitl/index.js";
import { EventBus } from "../events/bus.js";
import type { GuardrailsConfig, ContentFilter } from "../guardrails/types.js";
import type { ToolPermissions } from "../tools/types.js";
import type { EventListeners } from "../events/types.js";
import { AuditLog } from "../guardrails/audit.js";
import { BudgetTracker } from "../guardrails/budget.js";
import { ONITracer, type TracerLike } from "../telemetry.js";
import type { CustomStreamEvent, MessageStreamEvent } from "../types.js";

import type { PregelContext } from "./types.js";
import { streamSupersteps } from "./streaming.js";
import {
  getState, updateState, getStateAt, getHistory, forkFrom,
} from "./checkpointing.js";
import { getPendingInterrupts } from "./interrupts.js";

export class ONIPregelRunner<S extends Record<string, unknown>> {
  private hitlStore = new HITLSessionStore<S>();
  private nodeCache = new Map<string, { result: NodeReturn<S>; timestamp: number }>();
  private circuitBreakers = new Map<string, CircuitBreaker>();
  /** Count of concurrent subgraph invocations active on this runner. >0 means running as subgraph. */
  _subgraphRef = { count: 0 };
  /** Per-invocation parent updates from Command.PARENT, keyed by parent threadId. */
  readonly _perInvocationParentUpdates = new Map<string, Array<Partial<unknown>>>();
  /** Per-invocation checkpointer override for subgraph isolation, keyed by threadId. */
  readonly _perInvocationCheckpointer = new Map<string, unknown>();

  readonly eventBus: EventBus;
  readonly auditLog: AuditLog | null;
  readonly budgetTracker: BudgetTracker | null;
  private readonly contentFilters: ContentFilter[];
  private readonly toolPermissions: ToolPermissions | undefined;
  readonly tracer: ONITracer;

  /** Pre-indexed edges by source node — O(1) lookup instead of O(n) filter */
  private readonly _edgesBySource: Map<string, Edge<S>[]>;
  /** Pre-computed ephemeral channel keys — avoids iterating all channels */
  private readonly _ephemeralKeys: (keyof S)[];

  constructor(
    private readonly nodes:           Map<string, NodeDefinition<S>>,
    private readonly edges:           Edge<S>[],
    private readonly channels:        ChannelSchema<S>,
    private readonly interruptConfig: InterruptConfig = {},
    private readonly checkpointer:    ONICheckpointer<S> | null = null,
    private readonly store:           BaseStore | null = null,
    guardrails?:                      GuardrailsConfig,
    listeners?:                       EventListeners,
    private readonly defaults?:       { nodeTimeout?: number },
    private readonly dlq:             DeadLetterQueue | null = null,
    tracer?:                          TracerLike | null,
  ) {
    this.eventBus = new EventBus(listeners);
    this.auditLog = guardrails?.audit ? new AuditLog() : null;
    this.budgetTracker = guardrails?.budget ? new BudgetTracker(guardrails.budget) : null;
    this.contentFilters = guardrails?.filters ?? [];
    this.toolPermissions = guardrails?.toolPermissions;
    this.tracer = new ONITracer(tracer ?? null);

    // Pre-index edges by source for O(1) lookups in getNextNodes
    this._edgesBySource = new Map();
    for (const edge of edges) {
      const from = edge.from as string;
      let list = this._edgesBySource.get(from);
      if (!list) {
        list = [];
        this._edgesBySource.set(from, list);
      }
      list.push(edge);
    }

    // Pre-compute ephemeral keys to avoid scanning all channels per superstep
    this._ephemeralKeys = (Object.keys(channels) as (keyof S)[]).filter(
      (k) => channels[k].ephemeral,
    );
  }

  // ----------------------------------------------------------------
  // Build PregelContext for extracted functions
  // ----------------------------------------------------------------

  private get _ctx(): PregelContext<S> {
    return {
      nodes: this.nodes,
      edges: this.edges,
      channels: this.channels,
      interruptConfig: this.interruptConfig,
      checkpointer: this.checkpointer,
      store: this.store,
      circuitBreakers: this.circuitBreakers,
      tracer: this.tracer,
      eventBus: this.eventBus,
      auditLog: this.auditLog,
      budgetTracker: this.budgetTracker,
      contentFilters: this.contentFilters,
      toolPermissions: this.toolPermissions,
      dlq: this.dlq,
      hitlStore: this.hitlStore,
      defaults: this.defaults,
      nodeCache: this.nodeCache,
      _subgraphRef: this._subgraphRef,
      _perInvocationParentUpdates: this._perInvocationParentUpdates,
      _perInvocationCheckpointer: this._perInvocationCheckpointer,
      _edgesBySource: this._edgesBySource,
      _ephemeralKeys: this._ephemeralKeys,
    };
  }

  // ----------------------------------------------------------------
  // Core stream generator (delegates to streaming module)
  // ----------------------------------------------------------------

  async *_stream(
    input:      Partial<S>,
    config?:    ONIConfig,
    streamMode: StreamMode | StreamMode[] = "updates"
  ): AsyncGenerator<ONIStreamEvent<S> | CustomStreamEvent | MessageStreamEvent> {
    yield* streamSupersteps(this._ctx, input, config, streamMode);
  }

  // ----------------------------------------------------------------
  // Public API
  // ----------------------------------------------------------------

  async invoke(input: Partial<S>, config?: ONIConfig): Promise<S> {
    let finalState: S | undefined = undefined;
    for await (const evt of this._stream(input, config, "values")) {
      if (evt.event === "state_update") finalState = evt.data as S;
    }
    if (finalState === undefined) {
      throw new Error("Graph execution produced no state updates");
    }
    return finalState;
  }

  async *stream(
    input: Partial<S>,
    config?: ONIConfig & { streamMode?: StreamMode | StreamMode[] }
  ): AsyncGenerator<ONIStreamEvent<S> | CustomStreamEvent | MessageStreamEvent> {
    yield* this._stream(input, config, config?.streamMode ?? "updates");
  }

  async batch(inputs: Partial<S>[], config?: ONIConfig): Promise<S[]> {
    return Promise.all(
      inputs.map((inp, i) =>
        this.invoke(inp, {
          ...config,
          threadId: config?.threadId ? `${config.threadId}-${i}` : undefined,
        })
      )
    );
  }

  // ---- State ----

  async getState(threadId: string): Promise<S | null> {
    return getState(this.checkpointer, threadId);
  }

  async updateState(threadId: string, update: Partial<S>): Promise<void> {
    return updateState(this.checkpointer, this.channels, threadId, update);
  }

  // ---- Time-travel ----

  async getStateAt(threadId: string, step: number): Promise<S | null> {
    return getStateAt(this.checkpointer, threadId, step);
  }

  async getHistory(threadId: string): Promise<ONICheckpoint<S>[]> {
    return getHistory(this.checkpointer, threadId);
  }

  async forkFrom(threadId: string, step: number, newThreadId: string): Promise<void> {
    return forkFrom(this.checkpointer, threadId, step, newThreadId);
  }

  // ---- HITL ----

  getPendingInterrupts(threadId: string) {
    return getPendingInterrupts(this.hitlStore, threadId);
  }

  hitlSessionStore(): HITLSessionStore<S> {
    return this.hitlStore;
  }

  // ---- Dead Letter Queue ----

  getDeadLetters(threadId: string): DeadLetter[] {
    return this.dlq?.getAll(threadId) ?? [];
  }
}
