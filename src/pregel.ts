// ============================================================
// @oni.bot/core — Pregel Execution Engine v3
// New: interrupt() context management, HITL resume, token streaming
// ============================================================

import {
  START, END, Send, Command,
  type NodeName, type NodeDefinition, type Edge, type ChannelSchema,
  type ONIConfig, type ONIStreamEvent, type StreamMode, type InterruptConfig,
  type ONICheckpointer, type ONICheckpoint, type DynamicInterrupt,
  type NodeReturn, type CachePolicy,
} from "./types.js";
import { RecursionLimitError, NodeNotFoundError, ONIInterrupt, NodeTimeoutError, ONIError, NodeExecutionError, CircuitBreakerOpenError } from "./errors.js";
import { CircuitBreaker } from "./circuit-breaker.js";
import { DeadLetterQueue, type DeadLetter } from "./dlq.js";
import { withRetry } from "./retry.js";
import { MemoryCheckpointer } from "./checkpoint.js";
import { NamespacedCheckpointer } from "./checkpointers/namespaced.js";
import { _runWithContext, type RunContext, type StreamWriter } from "./context.js";
import type { BaseStore } from "./store/index.js";
import { StreamWriterImpl, _withTokenHandler } from "./streaming.js";
import type { CustomStreamEvent, MessageStreamEvent } from "./types.js";
import {
  NodeInterruptSignal, HITLInterruptException, HITLSessionStore,
  _installInterruptContext, _clearInterruptContext,
  type InterruptValue,
} from "./hitl/index.js";
import { EventBus } from "./events/bus.js";
import type { GuardrailsConfig } from "./guardrails/types.js";
import type { EventListeners } from "./events/types.js";
import { AuditLog } from "./guardrails/audit.js";
import { BudgetTracker } from "./guardrails/budget.js";
import { ONITracer, type TracerLike, type SpanLike } from "./telemetry.js";

const DEFAULT_RECURSION_LIMIT = 25;

interface PendingSend {
  node: string;
  args: Record<string, unknown>;
}

export class ONIPregelRunner<S extends Record<string, unknown>> {
  private hitlStore = new HITLSessionStore<S>();
  private nodeCache = new Map<string, { result: NodeReturn<S>; timestamp: number }>();
  private circuitBreakers = new Map<string, CircuitBreaker>();
  /** Set to true when this runner is being invoked as a subgraph */
  private _isSubgraph = false;
  /** Accumulated parent updates from Command.PARENT during subgraph execution */
  _parentUpdates: Array<Partial<unknown>> = [];

  readonly eventBus: EventBus;
  readonly auditLog: AuditLog | null;
  readonly budgetTracker: BudgetTracker | null;
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
  // State helpers
  // ----------------------------------------------------------------

  private buildInitialState(): S {
    const state = {} as S;
    for (const key of Object.keys(this.channels) as (keyof S)[]) {
      state[key] = this.channels[key].default();
    }
    return state;
  }

  private applyUpdate(current: S, update: Partial<S>): S {
    const keys = Object.keys(update) as (keyof S)[];
    if (keys.length === 0) return current;
    const next = { ...current };
    for (const key of keys) {
      if (update[key] !== undefined) {
        const ch = this.channels[key];
        next[key] = ch
          ? ch.reducer(current[key], update[key] as S[keyof S])
          : (update[key] as S[keyof S]);
      }
    }
    return next;
  }

  private resetEphemeral(state: S): S {
    if (this._ephemeralKeys.length === 0) return state;
    const next = { ...state };
    for (const key of this._ephemeralKeys) {
      next[key] = this.channels[key].default();
    }
    return next;
  }

  // ----------------------------------------------------------------
  // Edge resolution
  // ----------------------------------------------------------------

  private getNextNodes(
    fromNode: NodeName, state: S, config?: ONIConfig
  ): { nodes: NodeName[]; sends: PendingSend[] } {
    const outgoing = this._edgesBySource.get(fromNode as string) ?? [];
    const nodes: NodeName[] = [];
    const sends: PendingSend[] = [];

    for (const edge of outgoing) {
      if (edge.type === "static") {
        nodes.push(edge.to);
      } else {
        const result = edge.condition(state, config);
        const resolved = Array.isArray(result) ? result : [result];
        for (const r of resolved) {
          if (r instanceof Send) sends.push({ node: r.node, args: r.args });
          else nodes.push(edge.pathMap?.[r as string] ?? r);
        }
      }
    }
    return { nodes, sends };
  }

  // ----------------------------------------------------------------
  // Execute a node with interrupt() context installed
  // ----------------------------------------------------------------

  private async executeNode(
    nodeDef: NodeDefinition<S>,
    state:   S,
    config?: ONIConfig,
    resumeValue?: unknown,
    hasResume?: boolean,
    writer?: StreamWriter | null,
    step?: number,
    recursionLimit?: number,
  ): Promise<NodeReturn<S>> {
    // Check cache (compute key once, reuse for both lookup and store)
    let cacheKey: string | undefined;
    if (nodeDef.cache) {
      const policy: CachePolicy = typeof nodeDef.cache === "object" ? nodeDef.cache : {};
      const keyFn = policy.key ?? ((s: unknown) => JSON.stringify(s));
      cacheKey = `${nodeDef.name}::${keyFn(state)}`;
      const cached = this.nodeCache.get(cacheKey);
      if (cached) {
        const ttl = policy.ttl ?? Infinity;
        if (Date.now() - cached.timestamp < ttl) {
          return cached.result;
        }
        this.nodeCache.delete(cacheKey);
      }
    }

    const ctx: RunContext = {
      config:        config ?? {},
      store:         this.store,
      writer:        writer ?? null,
      state:         state,
      parentGraph:   null,
      parentUpdates: [],
      step:           step ?? 0,
      recursionLimit: recursionLimit ?? DEFAULT_RECURSION_LIMIT,
    };

    return _runWithContext(ctx, async () => {
      _installInterruptContext({
        nodeName:    nodeDef.name,
        resumeValue: resumeValue,
        hasResume:   hasResume ?? false,
      });

      try {
        const run = () => Promise.resolve(nodeDef.fn(state, config));

        // Core execute call: retry-aware
        const executeCall = async (): Promise<NodeReturn<S>> => {
          if (nodeDef.retry) return withRetry(run, nodeDef.name, nodeDef.retry);
          return run();
        };

        // Wrap with timeout if configured (per-node > global default > none)
        const timeoutMs = nodeDef.timeout ?? this.defaults?.nodeTimeout;
        const executeWithTimeout = async (): Promise<NodeReturn<S>> => {
          if (timeoutMs != null && timeoutMs > 0) {
            const ac = new AbortController();
            const timer = setTimeout(() => ac.abort(), timeoutMs);
            try {
              return await Promise.race([
                executeCall(),
                new Promise<never>((_, reject) => {
                  ac.signal.addEventListener("abort", () => {
                    reject(new NodeTimeoutError(nodeDef.name, timeoutMs));
                  });
                }),
              ]);
            } finally {
              clearTimeout(timer);
            }
          }
          return executeCall();
        };

        // Wrap with circuit breaker if configured
        const cb = this.getCircuitBreaker(nodeDef);
        let result: NodeReturn<S>;
        try {
          if (cb) {
            result = await cb.execute(executeWithTimeout);
          } else {
            result = await executeWithTimeout();
          }
        } catch (err) {
          // Pass through interrupt signals (thrown by interrupt() inside nodes)
          if (err instanceof NodeInterruptSignal) throw err;
          // Circuit breaker open — invoke user fallback with real state + error
          if (err instanceof CircuitBreakerOpenError && nodeDef.circuitBreaker?.fallback) {
            result = nodeDef.circuitBreaker.fallback(state, err) as NodeReturn<S>;
          } else {
            // Pass through structured ONI errors (NodeExecutionError from retry, NodeTimeoutError, etc.)
            if (err instanceof ONIError) throw err;
            // Wrap raw errors and non-Error throws in NodeExecutionError
            const cause = err instanceof Error ? err : new Error(String(err));
            throw new NodeExecutionError(nodeDef.name, cause);
          }
        }

        // Store in cache (reuse key computed above)
        if (nodeDef.cache && cacheKey) {
          this.nodeCache.set(cacheKey, { result, timestamp: Date.now() });
        }

        return result;
      } finally {
        _clearInterruptContext();
      }
    });
  }

  // ----------------------------------------------------------------
  // Dynamic interrupt check
  // ----------------------------------------------------------------

  private checkDynamicInterrupt(node: string, timing: "before" | "after", state: S, config?: ONIConfig): void {
    const dynamics = config?.dynamicInterrupts as DynamicInterrupt<S>[] | undefined;
    if (!dynamics) return;
    for (const di of dynamics) {
      if (di.node === node && di.timing === timing && di.condition(state)) {
        throw new ONIInterrupt(node, timing, state);
      }
    }
  }

  // ----------------------------------------------------------------
  // Core stream generator
  // ----------------------------------------------------------------

  async *_stream(
    input:      Partial<S>,
    config?:    ONIConfig,
    streamMode: StreamMode | StreamMode[] = "updates"
  ): AsyncGenerator<ONIStreamEvent<S>> {
    const threadId       = config?.threadId ?? `oni-${Date.now()}`;
    const recursionLimit = config?.recursionLimit ?? DEFAULT_RECURSION_LIMIT;
    const agentId        = config?.agentId;
    const modes = new Set(Array.isArray(streamMode) ? streamMode : [streamMode]);
    const isMultiMode = Array.isArray(streamMode);
    const tag = (evt: ONIStreamEvent<S>, mode: StreamMode): ONIStreamEvent<S> =>
      isMultiMode ? { ...evt, mode } : evt;

    // Pre-compute mode flags — eliminates ~20 Set.has() lookups per superstep
    const modeDebug    = modes.has("debug");
    const modeUpdates  = modes.has("updates");
    const modeValues   = modes.has("values");
    const modeCustom   = modes.has("custom");
    const modeMessages = modes.has("messages");

    // Telemetry: graph-level span
    const graphSpan = this.tracer.startGraphSpan("invoke", { threadId, agentId });

    // Load resume values from config (set by resume() call)
    const resumeMap = (config as ONIConfig & { __resumeValues?: Record<string, unknown> })?.__resumeValues ?? {};

    // Load or init state
    let state: S;
    let step = 0;
    let pendingNodes: NodeName[] = [];
    let pendingSends: PendingSend[] = [];

    if (this.checkpointer && config?.threadId) {
      const cp = await this.checkpointer.get(threadId);
      if (cp) {
        state        = this.applyUpdate(cp.state, input);
        step         = cp.step;
        pendingNodes = cp.nextNodes as NodeName[];
        pendingSends = cp.pendingSends ?? [];
      } else {
        state        = this.applyUpdate(this.buildInitialState(), input);
        const init   = this.getNextNodes(START, state, config);
        pendingNodes = init.nodes;
        pendingSends = init.sends;
      }
    } else {
      state        = this.applyUpdate(this.buildInitialState(), input);
      const init   = this.getNextNodes(START, state, config);
      pendingNodes = init.nodes;
      pendingSends = init.sends;
    }

    if (modeValues) yield tag(this.evt("state_update", state, step, agentId), "values");

    // ---- Main superstep loop ----
    while (true) {
      const nextNodes: NodeName[] = [];
      const nextSends: PendingSend[] = [];

      state = this.resetEphemeral(state);

      // Drain sends — group by target node for parallel fan-out execution
      const sendGroups = new Map<string, PendingSend[]>();
      for (const send of pendingSends) {
        if (!sendGroups.has(send.node)) sendGroups.set(send.node, []);
        sendGroups.get(send.node)!.push(send);
        if (modeDebug) yield tag(this.evt("send", send as unknown as Partial<S>, step, agentId, send.node), "debug");
      }

      // Execute fan-out sends (each Send → separate node execution with its own state)
      if (sendGroups.size > 0) {
        // Build promises directly — avoids spread+flatMap intermediate arrays
        const sendPromises: Promise<{ name: string; result: NodeReturn<S> }>[] = [];
        for (const [node, sends] of sendGroups) {
          const nodeDef = this.nodes.get(node);
          if (!nodeDef) throw new NodeNotFoundError(node);
          for (const send of sends) {
            sendPromises.push(
              (async () => {
                const sendState = this.applyUpdate(state, send.args as Partial<S>);
                const result = await this.executeNode(nodeDef, sendState, config, undefined, undefined, undefined, step, recursionLimit);
                return { name: node, result };
              })()
            );
          }
        }
        const sendResults = await Promise.all(sendPromises);

        // Reduce all send results through channels
        for (const { name, result } of sendResults) {
          if (result instanceof Command) {
            if (result.update) state = this.applyUpdate(state, result.update);
            const gotos = result.goto
              ? (Array.isArray(result.goto) ? result.goto : [result.goto])
              : this.getNextNodes(name, state, config).nodes;
            nextNodes.push(...gotos);
          } else if (result && typeof result === "object") {
            state = this.applyUpdate(state, result as Partial<S>);
            const { nodes, sends } = this.getNextNodes(name, state, config);
            nextNodes.push(...nodes);
            nextSends.push(...sends);
          } else {
            const { nodes, sends } = this.getNextNodes(name, state, config);
            nextNodes.push(...nodes);
            nextSends.push(...sends);
          }

          if (modeUpdates || modeDebug) {
            const delta = result instanceof Command ? (result.update ?? {}) : (result ?? {});
            if (modeUpdates) yield tag(this.evt("node_end", delta as Partial<S>, step, agentId, name), "updates");
            if (modeDebug) yield tag(this.evt("node_end", delta as Partial<S>, step, agentId, name), "debug");
          }
        }
      }
      pendingSends = [];

      // Filter executable nodes (non-END), excluding nodes already handled by sends
      const executableNodes = pendingNodes.filter((n) => n !== END && !sendGroups.has(n as string));
      if (executableNodes.length === 0 && sendGroups.size === 0) break;
      if (step >= recursionLimit) throw new RecursionLimitError(recursionLimit);

      // Emit debug node_start events before parallel execution
      if (modeDebug) {
        for (const nodeName of executableNodes) {
          const name = nodeName as string;
          if (!this.nodes.has(name)) throw new NodeNotFoundError(name);
          // Static interrupt BEFORE (check before emitting start)
          if (this.interruptConfig.interruptBefore?.includes(name))
            throw new ONIInterrupt(name, "before", state);
          this.checkDynamicInterrupt(name, "before", state, config);
          yield tag(this.evt("node_start", {} as Partial<S>, step, agentId, name), "debug");
        }
      }

      // Execute all active nodes in parallel
      const allCustomEvents: CustomStreamEvent[] = [];
      const allMessageEvents: MessageStreamEvent[] = [];
      const allSubgraphEvents: ONIStreamEvent<any>[] = [];
      const nodeWriters: Map<string, StreamWriterImpl> = new Map();

      const nodeResults = await Promise.all(
        executableNodes.map(async (nodeName) => {
          const name    = nodeName as string;
          const nodeDef = this.nodes.get(name);
          if (!nodeDef) throw new NodeNotFoundError(name);

          // Static interrupt BEFORE (non-debug mode)
          if (!modeDebug) {
            if (this.interruptConfig.interruptBefore?.includes(name))
              throw new ONIInterrupt(name, "before", state);
            this.checkDynamicInterrupt(name, "before", state, config);
          }

          // Create a StreamWriter for this node
          const messageId = `msg-${threadId}-${step}-${name}`;
          const customEvents: CustomStreamEvent[] = [];
          const messageEvents: MessageStreamEvent[] = [];
          const writerImpl = new StreamWriterImpl(
            (evt) => customEvents.push(evt),
            (token) => { /* legacy token callback — handled via writer.token() below */ },
            (evt) => messageEvents.push(evt),
            name,
            step,
            messageId,
            agentId,
          );
          nodeWriters.set(name, writerImpl);

          // Check if this node has a pending resume value
          const resumeValue = resumeMap[name];
          const hasResume   = name in resumeMap;

          // Emit agent.start lifecycle event
          const nodeStartTime = Date.now();
          this.eventBus.emit({ type: "agent.start", agent: name, timestamp: nodeStartTime, step });

          // Telemetry: node-level span
          const nodeSpan = this.tracer.startNodeSpan(name, { threadId, step, agentId });

          let result: NodeReturn<S>;
          let subParentUpdates: Array<Partial<unknown>> = [];
          try {
            // Scope emitToken to this node's async context via ALS — parallel nodes each
            // get their own handler so tokens are never dropped or misrouted.
            result = await _withTokenHandler(
              (token: string) => writerImpl.token(token),
              async () => {
                if (nodeDef.subgraph) {
                  // Mark child runner as a subgraph so Command.PARENT works
                  const childRunner = (nodeDef.subgraph as any)._runner as ONIPregelRunner<any> | undefined;
                  if (childRunner) {
                    childRunner._isSubgraph = true;
                    childRunner._parentUpdates = [];
                  }

                  // Save original checkpointer before potentially overwriting
                  const savedChildCheckpointer = childRunner ? (childRunner as any).checkpointer : undefined;

                  // Namespace the subgraph's checkpointer for isolation
                  if (this.checkpointer && childRunner) {
                    (childRunner as any).checkpointer = new NamespacedCheckpointer(this.checkpointer as any, name);
                  }

                  // Stream the subgraph — always restore child runner state, even on throw/interrupt
                  let subFinalState: Partial<S> | undefined;
                  try {
                    const childStreamMode: StreamMode[] = ["debug", "values"];
                    for await (const evt of nodeDef.subgraph.stream(state, {
                      ...config,
                      parentRunId: config?.threadId,
                      streamMode: childStreamMode,
                    })) {
                      // Namespace-prefix the node name
                      allSubgraphEvents.push({
                        ...evt,
                        node: evt.node ? `${name}:${evt.node}` : name,
                      });
                      // Track the last state_update as the final subgraph state
                      if (evt.event === "state_update") {
                        subFinalState = evt.data as Partial<S>;
                      }
                    }
                    if (childRunner) {
                      subParentUpdates = childRunner._parentUpdates;
                    }
                  } finally {
                    // Restore regardless of success, throw, or interrupt
                    if (childRunner) {
                      childRunner._isSubgraph = false;
                      childRunner._parentUpdates = [];
                      (childRunner as any).checkpointer = savedChildCheckpointer;
                    }
                  }
                  return subFinalState ?? {};
                } else {
                  return this.executeNode(nodeDef, state, config, resumeValue, hasResume, writerImpl, step, recursionLimit);
                }
              }
            );
          } catch (err) {
            // Catch interrupt() signals thrown from inside nodes
            if (err instanceof NodeInterruptSignal) {
              const iv: InterruptValue = {
                value:     err.value,
                node:      name,
                resumeId:  err.resumeId,
                timestamp: Date.now(),
              };

              // Save checkpoint before surfacing interrupt
              await this.saveCheckpoint(threadId, step, state, [name], pendingSends, agentId, config?.metadata);

              // Record HITL session if checkpointer exists
              if (this.checkpointer) {
                const cp = await this.checkpointer.get(threadId);
                if (cp) this.hitlStore.record(threadId, iv, cp);
              }

              throw new HITLInterruptException<S>(threadId, iv, state);
            }

            // Record to DLQ before re-throwing — use original cause if wrapped
            if (this.dlq && err instanceof Error) {
              const dlqErr = (err instanceof NodeExecutionError && err.cause instanceof Error) ? err.cause : err;
              this.dlq.record(threadId, name, state as unknown as Record<string, unknown>, dlqErr, nodeDef.retry?.maxAttempts ?? 1);
            }

            // Telemetry: record error on node span — use original cause if wrapped
            if (err instanceof Error) {
              const telErr = (err instanceof NodeExecutionError && err.cause instanceof Error) ? err.cause : err;
              this.tracer.recordError(nodeSpan, telErr);
            }
            this.tracer.endSpan(nodeSpan);
            throw err;
          }

          // Telemetry: end node span
          this.tracer.endSpan(nodeSpan);

          // Emit agent.end lifecycle event
          this.eventBus.emit({ type: "agent.end", agent: name, timestamp: Date.now(), step, duration: Date.now() - nodeStartTime });

          // Collect events for yielding after parallel execution
          allCustomEvents.push(...customEvents);
          allMessageEvents.push(...messageEvents);

          return { name, result, subParentUpdates };
        })
      );

      // Yield buffered subgraph events — filtered by parent's active modes
      for (const evt of allSubgraphEvents) {
        const e = evt as ONIStreamEvent<S>;
        if (modeDebug) {
          yield tag(e, "debug");
        } else if (modeUpdates && (e.event === "node_end")) {
          yield tag(e, "updates");
        } else if (modeValues && e.event === "state_update") {
          yield tag(e, "values");
        }
        // Custom and message events from subgraphs are forwarded if those modes are active
        if (modeCustom && (e as any).event === "custom") {
          yield tag(e, "custom");
        }
        if (modeMessages && ((e as any).event === "messages" || (e as any).event === "messages/complete")) {
          yield tag(e, "messages");
        }
      }

      // Apply results
      const stepWrites: Array<{ nodeId: string; writes: Record<string, unknown> }> = [];
      for (const { name, result, subParentUpdates: parentUpdates } of nodeResults) {
        if (result instanceof Command) {
          if (result.graph === Command.PARENT) {
            // Push update to parent — do NOT apply locally
            if (!this._isSubgraph) {
              throw new Error("Command.PARENT used but graph is not running as a subgraph");
            }
            if (result.update) this._parentUpdates.push(result.update);
            // Still resolve next nodes normally
            const { nodes, sends } = this.getNextNodes(name, state, config);
            nextNodes.push(...nodes);
            nextSends.push(...sends);
          } else {
            if (result.update) {
              state = this.applyUpdate(state, result.update);
              if (Object.keys(result.update as Record<string, unknown>).length > 0) {
                stepWrites.push({ nodeId: name, writes: result.update as Record<string, unknown> });
              }
            }
            const gotos = result.goto
              ? (Array.isArray(result.goto) ? result.goto : [result.goto])
              : this.getNextNodes(name, state, config).nodes;
            nextNodes.push(...gotos);
            if (result.send) nextSends.push(...result.send.map((s) => ({ node: s.node, args: s.args })));
          }
        } else if (result && typeof result === "object") {
          state = this.applyUpdate(state, result as Partial<S>);
          const writes = result as Record<string, unknown>;
          if (Object.keys(writes).length > 0) {
            stepWrites.push({ nodeId: name, writes });
          }
          const { nodes, sends } = this.getNextNodes(name, state, config);
          nextNodes.push(...nodes);
          nextSends.push(...sends);
        } else {
          const { nodes, sends } = this.getNextNodes(name, state, config);
          nextNodes.push(...nodes);
          nextSends.push(...sends);
        }

        // Apply parent updates from subgraph Command.PARENT (after normal result)
        for (const pu of parentUpdates) {
          state = this.applyUpdate(state, pu as Partial<S>);
        }

        if (modeUpdates || modeDebug) {
          const delta = result instanceof Command ? (result.update ?? {}) : (result ?? {});
          if (modeUpdates) yield tag(this.evt("node_end", delta as Partial<S>, step, agentId, name), "updates");
          if (modeDebug) yield tag(this.evt("node_end", delta as Partial<S>, step, agentId, name), "debug");
        }

        // Static interrupt AFTER
        if (this.interruptConfig.interruptAfter?.includes(name)) {
          await this.saveCheckpoint(threadId, step, state, nextNodes, nextSends, agentId, config?.metadata);
          throw new ONIInterrupt(name, "after", state);
        }
        this.checkDynamicInterrupt(name, "after", state, config);
      }

      // Yield buffered custom/message events based on stream mode
      if (modeCustom || modeDebug) {
        for (const evt of allCustomEvents) {
          if (modeCustom) yield tag(evt as unknown as ONIStreamEvent<S>, "custom");
          if (modeDebug) yield tag(evt as unknown as ONIStreamEvent<S>, "debug");
        }
      }
      if (modeMessages || modeDebug) {
        for (const evt of allMessageEvents) {
          if (modeMessages) yield tag(evt as unknown as ONIStreamEvent<S>, "messages");
          if (modeDebug) yield tag(evt as unknown as ONIStreamEvent<S>, "debug");
        }
        // Emit messages/complete for each node that produced tokens
        for (const [, writer] of nodeWriters) {
          const complete = writer._complete();
          if (complete) {
            if (modeMessages) yield tag(complete as unknown as ONIStreamEvent<S>, "messages");
            if (modeDebug) yield tag(complete as unknown as ONIStreamEvent<S>, "debug");
          }
        }
      }

      if (modeValues) yield tag(this.evt("state_update", state, step, agentId), "values");

      // Deduplicate nextNodes — avoid Set+spread when no dupes (common case)
      if (nextNodes.length <= 1) {
        pendingNodes = nextNodes;
      } else {
        const seen = new Set<string>();
        pendingNodes = [];
        for (const n of nextNodes) {
          const key = n as string;
          if (!seen.has(key)) {
            seen.add(key);
            pendingNodes.push(n);
          }
        }
      }
      pendingSends = nextSends;
      step++;
      await this.saveCheckpoint(threadId, step, state, pendingNodes, pendingSends, agentId, config?.metadata, stepWrites);
    }

    if (modeValues) yield tag(this.evt("state_update", state, step, agentId), "values");

    // Telemetry: end graph span
    graphSpan.setAttribute("oni.steps", step);
    this.tracer.endSpan(graphSpan);
  }

  // ----------------------------------------------------------------
  // Public API
  // ----------------------------------------------------------------

  async invoke(input: Partial<S>, config?: ONIConfig): Promise<S> {
    let finalState!: S;
    for await (const evt of this._stream(input, config, "values")) {
      if (evt.event === "state_update") finalState = evt.data as S;
    }
    return finalState;
  }

  async *stream(
    input: Partial<S>,
    config?: ONIConfig & { streamMode?: StreamMode | StreamMode[] }
  ): AsyncGenerator<ONIStreamEvent<S>> {
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
    if (!this.checkpointer) return null;
    return (await this.checkpointer.get(threadId))?.state ?? null;
  }

  async updateState(threadId: string, update: Partial<S>): Promise<void> {
    if (!this.checkpointer) return;
    const cp = await this.checkpointer.get(threadId);
    if (!cp) return;
    await this.checkpointer.put({ ...cp, state: this.applyUpdate(cp.state, update), timestamp: Date.now() });
  }

  // ---- Time-travel ----

  async getStateAt(threadId: string, step: number): Promise<S | null> {
    if (!this.checkpointer) return null;
    const history = await this.checkpointer.list(threadId);
    return history.find((c) => c.step === step)?.state ?? null;
  }

  async getHistory(threadId: string): Promise<ONICheckpoint<S>[]> {
    if (!this.checkpointer) return [];
    return this.checkpointer.list(threadId);
  }

  async forkFrom(threadId: string, step: number, newThreadId: string): Promise<void> {
    if (!this.checkpointer) return;
    const cp = this.checkpointer as MemoryCheckpointer<S>;
    if (typeof (cp as MemoryCheckpointer<S>).fork === "function") {
      await (cp as MemoryCheckpointer<S>).fork(threadId, step, newThreadId);
    } else {
      const history = await this.checkpointer.list(threadId);
      for (const c of history.filter((x) => x.step <= step)) {
        await this.checkpointer.put({ ...c, threadId: newThreadId });
      }
    }
  }

  // ---- HITL ----

  getPendingInterrupts(threadId: string) {
    return this.hitlStore.getByThread(threadId);
  }

  hitlSessionStore(): HITLSessionStore<S> {
    return this.hitlStore;
  }

  // ---- Circuit Breaker ----

  private getCircuitBreaker(nodeDef: NodeDefinition<S>): CircuitBreaker | null {
    if (!nodeDef.circuitBreaker) return null;
    let cb = this.circuitBreakers.get(nodeDef.name);
    if (!cb) {
      cb = new CircuitBreaker({
        threshold: nodeDef.circuitBreaker.threshold,
        resetAfter: nodeDef.circuitBreaker.resetAfter,
      }, nodeDef.name);
      this.circuitBreakers.set(nodeDef.name, cb);
    }
    return cb;
  }

  // ---- Dead Letter Queue ----

  getDeadLetters(threadId: string): DeadLetter[] {
    return this.dlq?.getAll(threadId) ?? [];
  }

  // ---- Helpers ----

  private async saveCheckpoint(
    threadId: string, step: number, state: S,
    nextNodes: NodeName[], pendingSends: PendingSend[], agentId?: string,
    metadata?: Record<string, unknown>,
    pendingWrites?: Array<{ nodeId: string; writes: Record<string, unknown> }>,
  ): Promise<void> {
    if (!this.checkpointer) return;
    const cpSpan = this.tracer.startCheckpointSpan("put", { threadId });
    await this.checkpointer.put({
      threadId, step, state, agentId, metadata, pendingWrites,
      nextNodes:    nextNodes.map(String),
      pendingSends: pendingSends,
      timestamp:    Date.now(),
    });
    this.tracer.endSpan(cpSpan);
  }

  private evt(
    event: ONIStreamEvent<S>["event"], data: Partial<S> | S,
    step: number, agentId?: string, node?: string
  ): ONIStreamEvent<S> {
    return { event, data, step, timestamp: Date.now(), agentId, node };
  }
}
