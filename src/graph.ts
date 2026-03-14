// ============================================================
// @oni.bot/core — StateGraph v3
// New: HITL resume(), getPendingInterrupts(), token streaming
// ============================================================

import {
  START, END,
  type NodeName, type NodeFn, type NodeDefinition, type Edge,
  type ChannelSchema, type ONIConfig, type ONISkeleton,
  type ONICheckpointer, type RetryPolicy, type CachePolicy, type ONICheckpoint,
  type ONIStreamEvent, type StreamMode,
  appendList,
} from "./types.js";
import { InvalidSkeletonError, EdgeConflictError, NodeNotFoundError } from "./errors.js";
import { DeadLetterQueue } from "./dlq.js";
import type { AgentNode } from "./agents/types.js";
import { ONIPregelRunner } from "./pregel.js";
import { NoopCheckpointer } from "./checkpoint.js";
import type { HITLSession } from "./hitl/index.js";
import type { BaseStore } from "./store/index.js";
import type { GuardrailsConfig } from "./guardrails/types.js";
import type { EventListeners } from "./events/types.js";
import type { TracerLike } from "./telemetry.js";

// ----------------------------------------------------------------
// ONISkeleton v3 — adds HITL resume + pending interrupts
// ----------------------------------------------------------------

export interface ONISkeletonV3<S> extends ONISkeleton<S> {
  /**
   * Resume a paused execution by providing a response to an interrupt.
   * The resumeId comes from the HITLInterruptException.interrupt.resumeId.
   */
  resume(
    config:   { threadId: string; resumeId: string },
    value:    unknown
  ): Promise<S>;

  /** Get all pending interrupt sessions for a thread */
  getPendingInterrupts(config: { threadId: string }): HITLSession<S>[];

  /** Get dead letters for a thread (only available when deadLetterQueue is enabled) */
  getDeadLetters?(config: { threadId: string }): import("./dlq.js").DeadLetter[];
}

// ----------------------------------------------------------------
// StateGraph
// ----------------------------------------------------------------

export class StateGraph<S extends Record<string, unknown>> {
  private nodes   = new Map<string, NodeDefinition<S>>();
  private edges:    Edge<S>[] = [];
  private readonly channels: ChannelSchema<S>;

  constructor(schema: { channels: ChannelSchema<S> }) {
    this.channels = schema.channels;
  }

  addNode(name: string, fn: NodeFn<S>, opts?: {
    retry?: RetryPolicy;
    cache?: boolean | CachePolicy;
    timeout?: number;
    circuitBreaker?: {
      threshold: number;
      resetAfter: number;
      fallback?: (state: S, error: Error) => import("./types.js").NodeReturn<S>;
    };
  }): this {
    if (name === START || name === END)
      throw new InvalidSkeletonError(`"${name}" is reserved.`);
    if (this.nodes.has(name))
      throw new InvalidSkeletonError(`Node "${name}" already registered.`);
    this.nodes.set(name, {
      name, fn,
      retry: opts?.retry,
      cache: opts?.cache,
      timeout: opts?.timeout,
      circuitBreaker: opts?.circuitBreaker,
    });
    return this;
  }

  addSubgraph(name: string, subgraph: ONISkeleton<S>, opts?: { retry?: RetryPolicy }): this {
    if (this.nodes.has(name)) throw new InvalidSkeletonError(`Node "${name}" already registered.`);
    const fn: NodeFn<S> = async (state, config) => subgraph.invoke(state, config) as Promise<Partial<S>>;
    this.nodes.set(name, { name, fn, retry: opts?.retry, subgraph });
    return this;
  }

  addAgent(agentNode: AgentNode<any>): this {
    return this.addNode(agentNode.name, agentNode._nodeFn);
  }

  addEdge(from: NodeName, to: NodeName | NodeName[]): this {
    const targets = Array.isArray(to) ? to : [to];
    for (const t of targets) {
      const dup = this.edges.find((e) => e.type === "static" && e.from === from && e.to === t);
      if (dup) throw new EdgeConflictError(from as string, t as string);
      this.edges.push({ type: "static", from, to: t });
    }
    return this;
  }

  addConditionalEdges(
    from: NodeName,
    condition: (state: S, config?: ONIConfig) => NodeName | NodeName[],
    pathMap?: Record<string, NodeName>
  ): this {
    this.edges.push({ type: "conditional", from, condition, pathMap });
    return this;
  }

  private validate(): void {
    let hasStartEdge = false;
    for (const edge of this.edges) {
      if (edge.from === START) hasStartEdge = true;
      if (edge.type === "static") {
        if (edge.to   !== END && !this.nodes.has(edge.to   as string)) throw new NodeNotFoundError(edge.to   as string);
        if (edge.from !== START && !this.nodes.has(edge.from as string)) throw new NodeNotFoundError(edge.from as string);
      } else {
        // Conditional edge: validate 'from' node exists
        if (edge.from !== START && !this.nodes.has(edge.from as string)) throw new NodeNotFoundError(edge.from as string);
        // Validate pathMap targets — catches typos at compile time rather than at runtime
        if (edge.pathMap) {
          for (const target of Object.values(edge.pathMap)) {
            if (target !== END && !this.nodes.has(target as string)) throw new NodeNotFoundError(target as string);
          }
        }
      }
    }
    if (!hasStartEdge)
      throw new InvalidSkeletonError("Skeleton must have at least one edge from START.");
  }

  compile(options: CompileOptions<S> = {}): ONISkeletonV3<S> {
    this.validate();

    const dlq = options.deadLetterQueue ? new DeadLetterQueue() : null;

    const runner = new ONIPregelRunner<S>(
      this.nodes,
      this.edges,
      this.channels,
      { interruptBefore: options.interruptBefore, interruptAfter: options.interruptAfter },
      options.checkpointer ?? null,
      options.store ?? null,
      options.guardrails,
      options.listeners,
      options.defaults,
      dlq,
      options.tracer ?? null,
    );

    const skeleton: ONISkeletonV3<S> = {
      invoke:      (input, config)  => runner.invoke(input, config),
      stream:      (input, config)  => runner.stream(input, config),
      batch:       (inputs, config) => runner.batch(inputs, config),
      getState:    (cfg)            => runner.getState(cfg.threadId),
      updateState: (cfg, update)    => runner.updateState(cfg.threadId, update),
      getStateAt:  (cfg)            => runner.getStateAt(cfg.threadId, cfg.step),
      getHistory:  (cfg)            => runner.getHistory(cfg.threadId),
      forkFrom:    (cfg)            => runner.forkFrom(cfg.threadId, cfg.step, cfg.newThreadId),

      // ---- HITL ----

      async resume(cfg, value) {
        const store = runner.hitlSessionStore();
        const session = store.get(cfg.resumeId);
        // Validate: session must exist and belong to the given threadId.
        // Falling back to "first pending" would silently misapply a cross-thread resumeId.
        if (!session || session.threadId !== cfg.threadId) {
          throw new Error(
            `resumeId "${cfg.resumeId}" not found or does not belong to thread "${cfg.threadId}"`
          );
        }
        const nodeKey = session.node;
        store.markResumed(cfg.resumeId);
        return runner.invoke(
          {},
          {
            threadId: cfg.threadId,
            __resumeValues: { [nodeKey]: value },
          } as ONIConfig & { __resumeValues: Record<string, unknown> }
        );
      },

      getPendingInterrupts(cfg) {
        return runner.getPendingInterrupts(cfg.threadId);
      },

      getDeadLetters(cfg) {
        return runner.getDeadLetters(cfg.threadId);
      },
    };

    // Attach runner as internal property for subgraph Command.PARENT support
    (skeleton as any)._runner = runner;
    return skeleton;
  }

  toMermaid(): string {
    const lines: string[] = ["graph TD"];
    const lbl = (n: NodeName) =>
      n === START ? "__start__" : n === END ? "__end__" : (n as string);
    for (const edge of this.edges) {
      lines.push(
        edge.type === "static"
          ? `    ${lbl(edge.from)} --> ${lbl(edge.to)}`
          : `    ${lbl(edge.from)} -->|?| conditional_${lbl(edge.from)}`
      );
    }
    lines.push(`    style __start__ fill:#7c3aed,color:#fff`);
    lines.push(`    style __end__   fill:#1e1e2e,color:#fff`);
    return lines.join("\n");
  }
}

export interface CompileOptions<S> {
  checkpointer?:    ONICheckpointer<S>;
  interruptBefore?: string[];
  interruptAfter?:  string[];
  store?:           BaseStore;
  guardrails?:      GuardrailsConfig;
  listeners?:       EventListeners;
  defaults?: {
    nodeTimeout?: number;
  };
  deadLetterQueue?: boolean;
  /** OTel-compatible tracer for distributed tracing. Pass any Tracer that satisfies TracerLike. */
  tracer?:          TracerLike;
}

// ----------------------------------------------------------------
// MessageGraph
// ----------------------------------------------------------------

export interface ONIMessage {
  role:          "user" | "assistant" | "system" | "tool";
  content:       string;
  name?:         string;
  tool_call_id?: string;
  tool_calls?:   ONIToolCall[];
}

export interface ONIToolCall {
  id: string; name: string; args: Record<string, unknown>;
}

export type MessageState = { messages: ONIMessage[] };

export class MessageGraph extends StateGraph<MessageState> {
  constructor() {
    super({ channels: { messages: appendList<ONIMessage>(() => []) } });
  }
}

// ----------------------------------------------------------------
// Re-export getGraph helper — called via skeleton.getGraph()
// ----------------------------------------------------------------
import { buildGraphDescriptor, toMermaidDetailed } from "./inspect.js";

// Extend StateGraph with getGraph
declare module "./graph.js" {
  interface StateGraph<S> {
    getGraph(): import("./inspect.js").GraphDescriptor;
    toMermaidDetailed(): string;
  }
}

StateGraph.prototype.getGraph = function <S extends Record<string, unknown>>(this: StateGraph<S>) {
  return buildGraphDescriptor((this as any).nodes, (this as any).edges);
};

StateGraph.prototype.toMermaidDetailed = function <S extends Record<string, unknown>>(this: StateGraph<S>) {
  const desc = buildGraphDescriptor((this as any).nodes, (this as any).edges);
  return toMermaidDetailed(desc);
};
