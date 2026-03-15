// ============================================================
// src/pregel/streaming.ts — Core superstep stream generator
// Note: Intentionally exceeds 300-line guideline. The superstep loop
// is a single indivisible concern (state → execute → checkpoint → route)
// that cannot be split without introducing shared mutable state between
// coroutines. All logic here belongs to one execution unit.
// ============================================================

import {
  START, END, Command,
  type NodeName, type ONIConfig, type ONIStreamEvent, type StreamMode,
  type NodeReturn,
} from "../types.js";
import { RecursionLimitError, NodeNotFoundError, ONIInterrupt, NodeExecutionError } from "../errors.js";
import { NamespacedCheckpointer } from "../checkpointers/namespaced.js";
import { StreamWriterImpl, _withTokenHandler } from "../streaming.js";
import {
  NodeInterruptSignal, HITLInterruptException,
  type InterruptValue,
} from "../hitl/index.js";
import type { CustomStreamEvent, MessageStreamEvent } from "../types.js";
import type { PregelContext, PendingSend } from "./types.js";
import { buildInitialState, applyUpdate, resetEphemeral, getNextNodes, checkDynamicInterrupt, evt } from "./state-helpers.js";
import { executeNode } from "./execution.js";
import { saveCheckpoint } from "./checkpointing.js";

// Monotonic counter for generating unique per-invocation keys (BUG-0035)
let _nextInvocationId = 0;

// Structural interface for the subgraph child runner — avoids circular import from ./index.js
interface SubgraphRunner {
  _subgraphRef: { count: number };
  _perInvocationParentUpdates: Map<string, Array<Partial<unknown>>>;
  _perInvocationCheckpointer: Map<string, unknown>;
}

export async function* streamSupersteps<S extends Record<string, unknown>>(
  ctx: PregelContext<S>,
  input: Partial<S>,
  config: ONIConfig | undefined,
  streamMode: StreamMode | StreamMode[] = "updates",
): AsyncGenerator<ONIStreamEvent<S> | CustomStreamEvent | MessageStreamEvent> {
  const threadId       = config?.threadId ?? `oni-${Date.now()}`;
  const recursionLimit = config?.recursionLimit ?? 25;
  const agentId        = config?.agentId;
  const modes = new Set(Array.isArray(streamMode) ? streamMode : [streamMode]);
  const isMultiMode = Array.isArray(streamMode);
  type AnyEvt = ONIStreamEvent<S> | CustomStreamEvent | MessageStreamEvent;
  const tag = (e: AnyEvt, mode: StreamMode): AnyEvt =>
    isMultiMode ? { ...e, mode } as AnyEvt : e;

  // Pre-compute mode flags — eliminates ~20 Set.has() lookups per superstep
  const modeDebug    = modes.has("debug");
  const modeUpdates  = modes.has("updates");
  const modeValues   = modes.has("values");
  const modeCustom   = modes.has("custom");
  const modeMessages = modes.has("messages");

  // Telemetry: graph-level span
  const graphSpan = ctx.tracer.startGraphSpan("invoke", { threadId, agentId });

  let step = 0; // declared before try so finally can read it for setAttribute
  try {

  // Load resume values from config (set by resume() call)
  const resumeMap = (config as ONIConfig & { __resumeValues?: Record<string, unknown> })?.__resumeValues ?? {};

  // Load or init state
  let state: S;
  let pendingNodes: NodeName[] = [];
  let pendingSends: PendingSend[] = [];

  const effectiveCheckpointer = (ctx._perInvocationCheckpointer.get(threadId) ?? ctx.checkpointer) as typeof ctx.checkpointer;
  if (effectiveCheckpointer && config?.threadId) {
    const cp = await effectiveCheckpointer.get(threadId);
    if (cp) {
      state        = applyUpdate(ctx.channels, cp.state, input);
      step         = cp.step;
      pendingNodes = cp.nextNodes as NodeName[];
      pendingSends = cp.pendingSends ?? [];
    } else {
      state        = applyUpdate(ctx.channels, buildInitialState(ctx.channels), input);
      const init   = getNextNodes(START, state, ctx._edgesBySource, config);
      pendingNodes = init.nodes;
      pendingSends = init.sends;
    }
  } else {
    state        = applyUpdate(ctx.channels, buildInitialState(ctx.channels), input);
    const init   = getNextNodes(START, state, ctx._edgesBySource, config);
    pendingNodes = init.nodes;
    pendingSends = init.sends;
  }

  if (modeValues) yield tag(evt("state_update", state, step, agentId), "values");

  // ---- Main superstep loop ----
  while (true) {
    const nextNodes: NodeName[] = [];
    const nextSends: PendingSend[] = [];

    state = resetEphemeral(state, ctx._ephemeralKeys, ctx.channels);

    // Drain sends — group by target node for parallel fan-out execution
    const sendGroups = new Map<string, PendingSend[]>();
    for (const send of pendingSends) {
      if (!sendGroups.has(send.node)) sendGroups.set(send.node, []);
      sendGroups.get(send.node)!.push(send);
      if (modeDebug) yield tag(evt("send", send as unknown as Partial<S>, step, agentId, send.node), "debug");
    }

    // Recursion limit guard — must fire before any sends execute so that
    // node side-effects are not applied to a step that will be discarded.
    if (step >= recursionLimit) throw new RecursionLimitError(recursionLimit);

    // Execute fan-out sends (each Send → separate node execution with its own state)
    if (sendGroups.size > 0) {
      // Build promises directly — avoids spread+flatMap intermediate arrays
      const sendPromises: Promise<{ name: string; result: NodeReturn<S> }>[] = [];
      for (const [node, sends] of sendGroups) {
        const nodeDef = ctx.nodes.get(node);
        if (!nodeDef) throw new NodeNotFoundError(node);
        for (const send of sends) {
          sendPromises.push(
            (async () => {
              const sendState = applyUpdate(ctx.channels, state, send.args as Partial<S>);
              const result = await executeNode(ctx, nodeDef, sendState, config, undefined, undefined, undefined, step, recursionLimit);
              return { name: node, result };
            })()
          );
        }
      }
      const sendSettled = await Promise.allSettled(sendPromises);

      // Check for rejected entries — collect results and throw first error after all settle
      const sendResults: { name: string; result: NodeReturn<S> }[] = [];
      let firstSendError: unknown = null;
      for (const settled of sendSettled) {
        if (settled.status === "fulfilled") {
          sendResults.push(settled.value);
        } else if (!firstSendError) {
          firstSendError = settled.reason;
        }
      }
      if (firstSendError) throw firstSendError;

      // Reduce all send results through channels
      for (const { name, result } of sendResults) {
        if (result instanceof Command) {
          if (result.update) state = applyUpdate(ctx.channels, state, result.update);
          const gotos = result.goto
            ? (Array.isArray(result.goto) ? result.goto : [result.goto])
            : getNextNodes(name, state, ctx._edgesBySource, config).nodes;
          nextNodes.push(...gotos);
        } else if (result && typeof result === "object") {
          state = applyUpdate(ctx.channels, state, result as Partial<S>);
          const { nodes, sends } = getNextNodes(name, state, ctx._edgesBySource, config);
          nextNodes.push(...nodes);
          nextSends.push(...sends);
        } else {
          const { nodes, sends } = getNextNodes(name, state, ctx._edgesBySource, config);
          nextNodes.push(...nodes);
          nextSends.push(...sends);
        }

        if (modeUpdates || modeDebug) {
          const delta = result instanceof Command ? (result.update ?? {}) : (result ?? {});
          if (modeUpdates) yield tag(evt("node_end", delta as Partial<S>, step, agentId, name), "updates");
          if (modeDebug) yield tag(evt("node_end", delta as Partial<S>, step, agentId, name), "debug");
        }
      }
    }
    pendingSends = [];

    // Filter executable nodes (non-END), excluding nodes already handled by sends
    const executableNodes = pendingNodes.filter((n) => n !== END && !sendGroups.has(n as string));
    if (executableNodes.length === 0 && sendGroups.size === 0) break;

    // Emit debug node_start events before parallel execution
    if (modeDebug) {
      for (const nodeName of executableNodes) {
        const name = nodeName as string;
        if (!ctx.nodes.has(name)) throw new NodeNotFoundError(name);
        // Static interrupt BEFORE (check before emitting start)
        if (ctx.interruptConfig.interruptBefore?.includes(name))
          throw new ONIInterrupt(name, "before", state);
        checkDynamicInterrupt(name, "before", state, config);
        yield tag(evt("node_start", {} as Partial<S>, step, agentId, name), "debug");
      }
    }

    // Execute all active nodes in parallel
    const allCustomEvents: CustomStreamEvent[] = [];
    const allMessageEvents: MessageStreamEvent[] = [];
    const allSubgraphEvents: (ONIStreamEvent<S> | CustomStreamEvent | MessageStreamEvent)[] = [];
    const nodeWriters: Map<string, StreamWriterImpl> = new Map();

    // Track the first HITL interrupt across all parallel nodes. We use
    // allSettled (not Promise.all) so that when one node raises an interrupt,
    // all other in-flight nodes complete before the interrupt is surfaced.
    // This prevents orphaned background executions that would apply side
    // effects without being checkpointed, causing double-application on resume.
    let pendingInterrupt: HITLInterruptException<S> | null = null;

    const allSettledResults = await Promise.allSettled(
      executableNodes.map(async (nodeName) => {
        const name    = nodeName as string;
        const nodeDef = ctx.nodes.get(name);
        if (!nodeDef) throw new NodeNotFoundError(name);

        // Static interrupt BEFORE (non-debug mode)
        if (!modeDebug) {
          if (ctx.interruptConfig.interruptBefore?.includes(name))
            throw new ONIInterrupt(name, "before", state);
          checkDynamicInterrupt(name, "before", state, config);
        }

        // Create a StreamWriter for this node
        const messageId = `msg-${threadId}-${step}-${name}`;
        const customEvents: CustomStreamEvent[] = [];
        const messageEvents: MessageStreamEvent[] = [];
        const writerImpl = new StreamWriterImpl(
          (e) => customEvents.push(e),
          (_token) => { /* legacy token callback — handled via writer.token() below */ },
          (e) => messageEvents.push(e),
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
        ctx.eventBus.emit({ type: "agent.start", agent: name, timestamp: nodeStartTime, step });

        // Telemetry: node-level span
        const nodeSpan = ctx.tracer.startNodeSpan(name, { threadId, step, agentId });

        let result: NodeReturn<S>;
        let subParentUpdates: Array<Partial<unknown>> = [];
        try {
          // Scope emitToken to this node's async context via ALS — parallel nodes each
          // get their own handler so tokens are never dropped or misrouted.
          result = await _withTokenHandler(
            (token: string) => writerImpl.token(token),
            async () => {
              if (nodeDef.subgraph) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const childRunner = (nodeDef.subgraph as any)._runner as SubgraphRunner | undefined; // SAFE: external boundary — subgraph._runner attached by graph.ts compile()
                // Per-invocation key for concurrent-safe state isolation
                // Include a unique counter suffix so concurrent calls sharing the
                // same threadId don't collide in _perInvocationParentUpdates / _perInvocationCheckpointer.
                const invocationKey = `${threadId}::${_nextInvocationId++}`;

                if (childRunner) {
                  childRunner._subgraphRef.count++;
                  childRunner._perInvocationParentUpdates.set(invocationKey, []);
                }

                // Install a namespaced checkpointer per invocation instead of swapping a shared field
                if (ctx.checkpointer && childRunner) {
                  childRunner._perInvocationCheckpointer.set(
                    invocationKey,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    new NamespacedCheckpointer(ctx.checkpointer as any, name), // SAFE: external boundary — checkpointer generic S differs between parent/child graph
                  );
                }

                // Stream the subgraph — always clean up per-invocation state, even on throw/interrupt
                let subFinalState: Partial<S> | undefined;
                try {
                  const childStreamMode: StreamMode[] = ["debug", "values"];
                  for await (const subEvt of nodeDef.subgraph.stream(state, {
                    ...config,
                    // Pass the parent's effective threadId explicitly so the child's
                    // _perInvocationParentUpdates lookup at Command.PARENT time uses
                    // the same key that was registered in invocationKey above.
                    threadId: invocationKey,
                    parentRunId: config?.threadId,
                    streamMode: childStreamMode,
                  })) {
                    // Namespace-prefix the node name
                    allSubgraphEvents.push({
                      ...subEvt,
                      node: subEvt.node ? `${name}:${subEvt.node}` : name,
                    });
                    // Track the last state_update as the final subgraph state
                    if (subEvt.event === "state_update") {
                      subFinalState = subEvt.data as Partial<S>;
                    }
                  }
                  if (childRunner) {
                    subParentUpdates = childRunner._perInvocationParentUpdates.get(invocationKey) ?? [];
                  }
                } finally {
                  // Clean up per-invocation state — decrement ref count, remove Maps entries
                  if (childRunner) {
                    childRunner._subgraphRef.count--;
                    childRunner._perInvocationParentUpdates.delete(invocationKey);
                    childRunner._perInvocationCheckpointer.delete(invocationKey);
                  }
                }
                return subFinalState ?? {};
              } else {
                return executeNode(ctx, nodeDef, state, config, resumeValue, hasResume, writerImpl, step, recursionLimit);
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

            const exc = new HITLInterruptException<S>(threadId, iv, state);
            // Claim the first-interrupt slot SYNCHRONOUSLY before any await.
            // Both concurrent interrupt handlers check this flag before yielding,
            // so whichever catch block runs first exclusively owns the checkpoint
            // save. Without this guard, the last saveCheckpoint wins and its
            // nextNodes diverge from pendingInterrupt's node, corrupting resume().
            const isFirstInterrupt = !pendingInterrupt;
            if (isFirstInterrupt) pendingInterrupt = exc;

            // Only save checkpoint for the first interrupt — the stored nextNodes
            // must match pendingInterrupt's node so resume() restores correctly.
            if (isFirstInterrupt) {
              await saveCheckpoint(ctx, threadId, step, state, [name], pendingSends, agentId, config?.metadata);

              // Record HITL session if checkpointer exists
              if (effectiveCheckpointer) {
                const cp = await effectiveCheckpointer.get(threadId);
                if (cp) ctx.hitlStore.record(threadId, iv, cp);
              }
            }

            throw exc; // marks this node's settled result as rejected
          }

          // Record to DLQ before re-throwing — use original cause if wrapped
          if (ctx.dlq && err instanceof Error) {
            const dlqErr = (err instanceof NodeExecutionError && err.cause instanceof Error) ? err.cause : err;
            ctx.dlq.record(threadId, name, state as unknown as Record<string, unknown>, dlqErr, nodeDef.retry?.maxAttempts ?? 1);
          }

          // Telemetry: record error on node span — use original cause if wrapped
          if (err instanceof Error) {
            const telErr = (err instanceof NodeExecutionError && err.cause instanceof Error) ? err.cause : err;
            ctx.tracer.recordError(nodeSpan, telErr);
          }
          ctx.tracer.endSpan(nodeSpan);

          // Lifecycle event: emit error for non-interrupt failures
          if (err instanceof Error) {
            ctx.eventBus.emit({ type: "error", agent: name, error: err, timestamp: Date.now() });
          }
          throw err;
        }

        // Telemetry: end node span
        ctx.tracer.endSpan(nodeSpan);

        // Emit agent.end lifecycle event
        ctx.eventBus.emit({ type: "agent.end", agent: name, timestamp: Date.now(), step, duration: Date.now() - nodeStartTime });

        // Collect events for yielding after parallel execution
        allCustomEvents.push(...customEvents);
        allMessageEvents.push(...messageEvents);

        return { name, result, subParentUpdates };
      })
    );

    // Extract results now that all nodes have settled.
    // Re-throw the first non-interrupt error (DLQ/telemetry already handled
    // inside each node's catch block), then surface any HITL interrupt.
    const nodeResults: Array<{ name: string; result: NodeReturn<S>; subParentUpdates: Array<Partial<unknown>> }> = [];
    for (const settled of allSettledResults) {
      if (settled.status === "fulfilled") {
        nodeResults.push(settled.value);
      } else if (!(settled.reason instanceof HITLInterruptException)) {
        throw settled.reason; // first non-interrupt error
      }
    }
    if (pendingInterrupt) throw pendingInterrupt;

    // Yield buffered subgraph events — filtered by parent's active modes
    for (const subEvt of allSubgraphEvents) {
      const e = subEvt as ONIStreamEvent<S>;
      if (modeDebug) {
        yield tag(e, "debug");
      } else if (modeUpdates && (e.event === "node_end")) {
        yield tag(e, "updates");
      } else if (modeValues && e.event === "state_update") {
        yield tag(e, "values");
      }
      // Custom and message events from subgraphs are forwarded if those modes are active
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (modeCustom && (e as any).event === "custom") { // SAFE: narrowing union event type that doesn't include "custom" in current TS discriminant
        yield tag(e, "custom");
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (modeMessages && ((e as any).event === "messages" || (e as any).event === "messages/complete")) { // SAFE: narrowing union event type
        yield tag(e, "messages");
      }
    }

    // Apply results
    const stepWrites: Array<{ nodeId: string; writes: Record<string, unknown> }> = [];
    for (const { name, result, subParentUpdates: parentUpdates } of nodeResults) {
      if (result instanceof Command) {
        if (result.graph === Command.PARENT) {
          // Push update to parent — do NOT apply locally
          if (!ctx._subgraphRef.count) {
            throw new Error("Command.PARENT used but graph is not running as a subgraph");
          }
          if (result.update) {
            const myParentUpdates = ctx._perInvocationParentUpdates.get(threadId);
            if (myParentUpdates) myParentUpdates.push(result.update);
          }
          // Still resolve next nodes normally
          const { nodes, sends } = getNextNodes(name, state, ctx._edgesBySource, config);
          nextNodes.push(...nodes);
          nextSends.push(...sends);
        } else {
          if (result.update) {
            state = applyUpdate(ctx.channels, state, result.update);
            if (Object.keys(result.update as Record<string, unknown>).length > 0) {
              stepWrites.push({ nodeId: name, writes: result.update as Record<string, unknown> });
            }
          }
          const gotos = result.goto
            ? (Array.isArray(result.goto) ? result.goto : [result.goto])
            : getNextNodes(name, state, ctx._edgesBySource, config).nodes;
          nextNodes.push(...gotos);
          if (result.send) nextSends.push(...result.send.map((s) => ({ node: s.node, args: s.args })));
        }
      } else if (result && typeof result === "object") {
        state = applyUpdate(ctx.channels, state, result as Partial<S>);
        const writes = result as Record<string, unknown>;
        if (Object.keys(writes).length > 0) {
          stepWrites.push({ nodeId: name, writes });
        }
        const { nodes, sends } = getNextNodes(name, state, ctx._edgesBySource, config);
        nextNodes.push(...nodes);
        nextSends.push(...sends);
      } else {
        const { nodes, sends } = getNextNodes(name, state, ctx._edgesBySource, config);
        nextNodes.push(...nodes);
        nextSends.push(...sends);
      }

      // Apply parent updates from subgraph Command.PARENT (after normal result)
      for (const pu of parentUpdates) {
        state = applyUpdate(ctx.channels, state, pu as Partial<S>);
      }

      if (modeUpdates || modeDebug) {
        const delta = result instanceof Command ? (result.update ?? {}) : (result ?? {});
        if (modeUpdates) yield tag(evt("node_end", delta as Partial<S>, step, agentId, name), "updates");
        if (modeDebug) yield tag(evt("node_end", delta as Partial<S>, step, agentId, name), "debug");
      }

      // Static interrupt AFTER
      if (ctx.interruptConfig.interruptAfter?.includes(name)) {
        await saveCheckpoint(ctx, threadId, step, state, nextNodes, nextSends, agentId, config?.metadata);
        throw new ONIInterrupt(name, "after", state);
      }
      checkDynamicInterrupt(name, "after", state, config);
    }

    // Yield buffered custom/message events based on stream mode
    if (modeCustom || modeDebug) {
      for (const customEvt of allCustomEvents) {
        if (modeCustom) yield tag(customEvt, "custom");
        if (modeDebug) yield tag(customEvt, "debug");
      }
    }
    if (modeMessages || modeDebug) {
      for (const msgEvt of allMessageEvents) {
        if (modeMessages) yield tag(msgEvt, "messages");
        if (modeDebug) yield tag(msgEvt, "debug");
      }
      // Emit messages/complete for each node that produced tokens
      for (const [, writer] of nodeWriters) {
        const complete = writer._complete();
        if (complete) {
          if (modeMessages) yield tag(complete, "messages");
          if (modeDebug) yield tag(complete, "debug");
        }
      }
    }

    if (modeValues) yield tag(evt("state_update", state, step, agentId), "values");

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
    await saveCheckpoint(ctx, threadId, step, state, pendingNodes, pendingSends, agentId, config?.metadata, stepWrites);
  }

  if (modeValues) yield tag(evt("state_update", state, step, agentId), "values");

  } finally {
    // Telemetry: end graph span — always runs, even on error or interrupt
    graphSpan.setAttribute("oni.steps", step);
    ctx.tracer.endSpan(graphSpan);
  }
}
