# ONI Core Runtime — Internal Design

> Source of truth for the execution model, checkpointing contract, HITL lifecycle,
> event routing, and streaming guarantees implemented in `@oni.bot/core`.

---

## Execution Model

`ONIPregelRunner` drives execution as a **superstep loop** over the graph. Each
iteration of the loop is one superstep:

1. **Ephemeral reset** — channels marked `ephemeral: true` are reset to their
   default value at the start of every superstep so they never accumulate
   cross-step state.

2. **Send fan-out** — pending `Send` objects (queued by nodes returning
   `Command` or by conditional edges returning `new Send(node, args)`) are
   grouped by target node and executed with `Promise.all`. Each send creates a
   private copy of state (`applyUpdate(state, send.args)`) before invoking the
   target node, preventing interference between concurrent sends.

3. **Parallel node execution** — all nodes whose names appear in `pendingNodes`
   are executed concurrently with `Promise.allSettled`. Using `allSettled`
   instead of `Promise.all` means that when one node throws a HITL interrupt
   the other in-flight nodes are allowed to finish before the interrupt is
   surfaced, preventing orphaned background executions that would apply
   side-effects without being checkpointed.

4. **State merge** — each fulfilled node result is folded into `state` via
   `applyUpdate`, which calls the channel's `reducer` function for every key
   present in the partial update. Keys absent from the update are left
   untouched.

5. **Recursion limit** — checked at the top of each superstep iteration. If
   `step >= recursionLimit` (default `25`, overridable via
   `config.recursionLimit`), a `RecursionLimitError` is thrown before any node
   executes.

6. **Checkpoint per superstep** — after all nodes in a superstep have settled
   and state has been updated, `saveCheckpoint` writes the new state plus
   `nextNodes` and `pendingSends` to the checkpointer. On the next `invoke` call
   with the same `threadId`, the runner loads this checkpoint and resumes from
   the recorded `pendingNodes` rather than restarting from `START`.

7. **Edge resolution** — edges are pre-indexed at construction into
   `_edgesBySource: Map<string, Edge[]>` for O(1) lookup. Static edges push
   their `to` node directly; conditional edges call `edge.condition(state,
   config)` and map the returned string/Send through an optional `pathMap`.

---

## Node Execution Pipeline

`executeNode` applies the following pipeline to every node invocation, in order:

```
cache hit? → return cached result (TTL-aware, FIFO eviction at 256 entries)
     ↓
content filter (input direction) — runFilters() against state JSON
     ↓
retry wrapper (withRetry) — if nodeDef.retry is configured
     ↓
timeout race (Promise.race + AbortController) — nodeDef.timeout ?? defaults.nodeTimeout
     ↓
circuit breaker (cb.execute) — wraps the timeout+retry composite
     ↓
nodeDef.fn(state, config) — the user-supplied node function
     ↓
content filter (output direction) — runFilters() against result JSON
     ↓
cache write — stores result with timestamp if nodeDef.cache is set
     ↓
return NodeReturn<S>
```

**What throws at each stage:**

- `NodeTimeoutError` — thrown by the AbortController listener when the timeout
  fires before `executeCall()` resolves.
- `CircuitBreakerOpenError` — thrown by `CircuitBreaker.execute` when the
  breaker is in open state (too many recent failures). If `nodeDef.circuitBreaker.fallback`
  is provided the error is swallowed and the fallback result is used instead.
- `NodeExecutionError` — wraps any raw `Error` (or string throw) that escapes
  from `nodeDef.fn` and is not already a structured `ONIError`. The original
  error is stored as `.cause`.
- `NodeInterruptSignal` — thrown by `interrupt()` inside a node when there is
  no queued resume value. This is **not** wrapped; it passes through the `catch`
  block untouched and is handled by the superstep loop.

The interrupt context (`_installInterruptContext`) is installed via
`AsyncLocalStorage` before the node function executes and cleared in the
`finally` block, ensuring parallel nodes never share resume-value queues.

---

## Checkpointing Contract

**Scope:** Every checkpoint is keyed by `threadId`. The runner never writes a
checkpoint for one `threadId` into another. When `config.threadId` is absent a
synthetic id (`oni-<timestamp>`) is generated for the run but no checkpoint is
persisted (the checkpointer is bypassed when `config.threadId` is falsy).

**When checkpoints are written:**

- After every successfully completed superstep (`step++` at line 813,
  `saveCheckpoint` at line 814).
- Immediately before surfacing a HITL interrupt (line 632 — state and
  `nextNodes: [name]` are written so resume() knows which node to re-run).
- After `interruptAfter` fires (line 768).

**Checkpoint contents:** `{ threadId, step, state, nextNodes, pendingSends,
agentId, metadata, pendingWrites, timestamp }`.

**Subgraph isolation via `_perInvocationCheckpointer`:** When a node is marked
as a subgraph, the parent runner installs a `NamespacedCheckpointer` (keyed by
`"<nodeName>/"` prefix) into `_perInvocationCheckpointer` for the duration of
that invocation. The child runner reads from this namespaced instance rather
than the global checkpointer, so subgraph steps never collide with parent steps
in the same thread.

**`MemoryCheckpointer.fork()`:** Called by `forkFrom(threadId, step,
newThreadId)`. It copies all checkpoints up to `step` from `threadId` and
re-writes them under `newThreadId`, enabling time-travel branching without
mutating the original history.

---

## HITL Lifecycle

HITL (Human-in-the-Loop) uses two orthogonal mechanisms:

### 1. `interrupt()` — mid-node suspension (runtime)

Called from inside a node body. Uses `AsyncLocalStorage` (`interruptALS`) to
find the current `InterruptContext` which holds a queue of `resumeValues`.

- **First run (no resume):** `resumeValues` is empty, so `interrupt()` generates
  a `resumeId` (`"<nodeName>-<timestamp>-<random>"`) and throws
  `NodeInterruptSignal(value, resumeId)`.
- **On resume:** `resumeValues` contains the human's answer (injected by
  `resume()` via `__resumeValues`). `interrupt()` calls `shift()` and returns
  the value, letting the node continue past the interrupt point.

### 2. Runner catch and record

In the superstep loop, each node is executed inside a `Promise.allSettled`
promise. When `NodeInterruptSignal` is caught:

1. An `InterruptValue` (`{ value, node, resumeId, timestamp }`) is built.
2. A `HITLInterruptException<S>` is constructed with the current `threadId`,
   `InterruptValue`, and state snapshot.
3. Only the **first** interrupt in this superstep saves a checkpoint
   (`isFirstInterrupt` flag) — subsequent concurrent interrupts are discarded.
   The saved checkpoint records `nextNodes: [name]` (the interrupted node) so
   resume will re-run exactly that node.
4. `hitlStore.record(threadId, iv, cp)` persists the `HITLSessionStore` entry
   linking `resumeId → { threadId, node, checkpoint }`.
5. `HITLInterruptException` is re-thrown, causing `allSettled` to mark that
   slot as rejected.
6. After all nodes settle, the runner checks `pendingInterrupt` and throws it,
   propagating to the caller as a `HITLInterruptException`.

### 3. `resume()` — continuing after interrupt

Exposed on `ONISkeletonV3.resume({ threadId, resumeId }, value)`:

1. Looks up `resumeId` in `HITLSessionStore`. Throws if not found or if
   `session.threadId !== cfg.threadId` (cross-thread resumeId guard).
2. Calls `runner.invoke({}, { threadId, __resumeValues: { [nodeKey]: value } })`.
3. The runner loads the saved checkpoint (which has `nextNodes: [interruptedNode]`)
   and injects `__resumeValues` into the resume map.
4. When `executeNode` runs for the interrupted node, `_installInterruptContext`
   is called with `resumeValues: [value]`, so the next call to `interrupt()`
   inside that node returns the value instead of throwing.
5. If `invoke` succeeds, `store.markResumed(resumeId)` transitions the session
   from pending to resumed. If `invoke` throws the session remains pending so
   the caller can retry.

### 4. `interruptBefore` / `interruptAfter` — boundary interrupts (compile-time)

Set via `compile({ interruptBefore: ["nodeA"] })`. Checked at node boundaries
(before or after the user function runs). These throw `ONIInterrupt` rather than
`HITLInterruptException` and do not create HITL sessions.

---

## Event Routing

`EventBus` provides typed, fault-isolated publish/subscribe. It is constructed
inside `ONIPregelRunner` and exposed as `runner.eventBus`.

**Registration:**

- `on(type, handler)` — registers a handler for a specific event type. Returns
  an unsubscribe function. Handlers are stored in a `Map<string, Set<handler>>`.
- `onAll(handler)` — registers a handler that receives every event regardless
  of type. Stored in a separate `Set`.
- `once(type, handler)` — one-shot: auto-unsubscribes after the first matching
  event.
- `waitFor(type, timeoutMs)` — returns a `Promise` that resolves on the next
  event of that type or rejects after `timeoutMs` (default 60 s).

**Initial listeners** are passed at construction via `compile({ listeners })`.
`EventBus` iterates the `listeners` record and calls `on()` for each entry.

**`emit(event)`** iterates the type-specific `Set` first, then the `allHandlers`
`Set`. Each handler invocation is wrapped in a `try/catch`:

```ts
try { h(event); } catch (err) {
  console.error(`[EventBus] listener error on "${event.type}":`, err);
}
```

Errors in listeners are printed to stderr and **never propagated** to the
emitter. This ensures a misbehaving observer cannot crash the graph.

**Events fired by the runner:**

| Event | When |
|---|---|
| `agent.start` | Before a node executes (contains `agent`, `step`, `timestamp`) |
| `agent.end` | After a node completes successfully (contains `duration`) |
| `error` | When a node throws a non-interrupt error |
| `filter.blocked` | When a content filter blocks input or output |
| `cron.fired` | When the cron scheduler fires a job |

The `_emitEvent` closure on `RunContext` routes through `eventBus.emit` so that
node-internal code (e.g., model adapters) can also emit lifecycle events without
a direct reference to the runner.

---

## Streaming Contract

`stream()` is a public `AsyncGenerator` over `ONIStreamEvent<S> |
CustomStreamEvent | MessageStreamEvent`. Internally it delegates to `_stream()`,
which is the superstep loop that yields events as they are produced.

**`StreamMode` values and what they yield:**

| Mode | Events yielded |
|---|---|
| `"values"` | `state_update` after every superstep (full state snapshot) |
| `"updates"` | `node_end` events carrying the partial update returned by each node |
| `"debug"` | All events: `node_start`, `node_end`, `state_update`, `send` |
| `"custom"` | `custom` events emitted by `writer.emit(name, data)` inside nodes |
| `"messages"` | `messages` (per-token) and `messages/complete` events from `StreamWriterImpl` |

Multiple modes can be requested simultaneously by passing an array:
`config.streamMode = ["updates", "messages"]`. In multi-mode, each yielded
event carries a `mode` tag.

**`invoke()` vs `stream()`:** `invoke` drains `_stream` in `"values"` mode and
returns the last `state_update` datum, providing a simple async call with no
streaming overhead for callers that do not need intermediate events.

**Token-level streaming with `BoundedBuffer`:**

`StreamWriterImpl` accumulates tokens via `writer.token(chunk)`. Each call
emits a `messages` event immediately and appends to `_accumulated`. After the
node function returns, `_complete()` emits a `messages/complete` event with the
full assembled content.

`BoundedBuffer<T>` is a fixed-capacity ring buffer used for backpressure-aware
event buffering within a node. It supports two strategies:

- `"drop-oldest"` — when full, the oldest item is evicted and the new item
  takes its place (lossy but non-blocking).
- `"error"` — when full, `push()` throws
  `"ONI_STREAM_BACKPRESSURE: Stream buffer full"` (blocking — forces the
  producer to slow down).

The buffer capacity and strategy are configurable per-use-site.

Token handlers are scoped to each node's async execution via a second
`AsyncLocalStorage` (`tokenHandlerALS`). The runner wraps each node call with
`_withTokenHandler(writer.token, fn)`, ensuring tokens from concurrent parallel
nodes are routed to their respective `StreamWriterImpl` instances and never
cross-contaminated.

---

## Key Invariants

1. **Checkpoints are scoped by threadId — no cross-thread state bleed.**
   `saveCheckpoint` always passes the runtime `threadId` as the primary key.
   The `resume()` API validates that `session.threadId === cfg.threadId` before
   proceeding, so a `resumeId` from thread A cannot be applied to thread B.

2. **Subgraph results update parent state only via their returned `Partial<S>`;
   subgraph uses isolated checkpointer.**
   The child runner writes its steps under a `NamespacedCheckpointer` prefixed
   by the subgraph node name, not the parent's flat namespace. The parent
   receives only the final `subFinalState` from the subgraph's last
   `state_update` event.

3. **`interrupt()` always saves checkpoint before suspending (via
   `hitlStore.record` after `saveCheckpoint`).**
   The interrupt catch block in the superstep loop calls `saveCheckpoint` then
   `hitlStore.record` before re-throwing `HITLInterruptException`. The session
   stored in `hitlStore` references the saved checkpoint, so `resume()` can
   always reconstruct the pre-interrupt state.

4. **`resume()` re-runs only the interrupted node using `__resumeValues` — not
   prior nodes.**
   The checkpoint saved at interrupt time records `nextNodes: [interruptedNode]`.
   When `resume()` calls `invoke`, the runner loads that checkpoint and starts
   the superstep with only the one interrupted node in `pendingNodes`.
   `__resumeValues` is passed in config; `executeNode` sees `hasResume: true`
   and populates `resumeValues` so `interrupt()` returns rather than re-throws.

5. **EventBus listener errors are caught and `console.error`'d — never
   propagated to the emitter.**
   Each handler call inside `emit()` is wrapped in `try/catch`. The caught
   error is printed to stderr with the event type for diagnostics. Subsequent
   handlers in the same `Set` continue to execute regardless.

6. **`BudgetTracker` overrun throws `BudgetExceededError` when
   `onBudgetExceeded` is `"error"` (default).**
   `BudgetTracker.record()` checks per-agent token totals, per-run token totals,
   and cumulative cost after every model call. When any limit is exceeded and
   `config.onBudgetExceeded ?? "error"` equals `"error"`, it throws
   `BudgetExceededError` synchronously, aborting the node before it can
   continue. Setting `onBudgetExceeded: "log"` instead records an audit entry
   and continues.

7. **Circuit breaker open-state rejects calls without executing the user
   function (`CircuitBreakerOpenError`).**
   `CircuitBreaker.execute(fn)` inspects its internal state machine before
   calling `fn`. When the breaker is open (failure threshold exceeded and reset
   window not yet elapsed), it throws `CircuitBreakerOpenError` immediately. If
   `nodeDef.circuitBreaker.fallback` is provided the error is caught inside
   `executeNode` and the fallback result is returned instead; otherwise the
   error propagates and is recorded in the DLQ.
