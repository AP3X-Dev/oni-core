# Changelog

All notable changes to @oni.bot/core are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] — 2026-03-13

### Fixed
- **Budget guardrails:** `BudgetTracker.record()` is now called from `defineAgent` after each `model.chat()` via a RunContext callback; throws `BudgetExceededError` when `maxTokensPerRun`/`maxTokensPerAgent`/`maxCostPerRun` is exceeded.
- **defineAgent ToolContext:** `store` and stream `emit` now read from the live RunContext instead of being hard-coded to `null`/noop, so tools receive the real store and can emit custom stream events.
- **parallelSafe enforcement:** `parallelSafe: false` is now preserved through `ToolDefinition` and respected by `defineAgent` — when any tool in a batch has `parallelSafe: false` all calls in that step execute sequentially.
- **pathMap compile-time validation:** `StateGraph.compile()` now validates conditional edge `pathMap` targets at compile time, throwing `NodeNotFoundError` instead of failing silently at runtime.
- **spawnAgent in unsupervised swarms:** `spawnAgent()` now throws a clear error when called on a swarm without a supervisor, rather than silently adding an agent that never executes.
- **removeAgent edge cleanup:** `removeAgent()` now removes stale static edges pointing to the removed node from `_edgesBySource`, preventing `NodeNotFoundError` when Pregel tries to route to a removed agent.
- **Lifecycle events from defineAgent:** `llm.request`, `llm.response`, `tool.call`, and `tool.result` events are now emitted and audit entries written for every model call and tool execution inside `defineAgent`.
- **toolPermissions enforcement:** `checkToolPermission()` is called before each tool execution in `defineAgent`, outside the tool's try/catch, so `ToolPermissionError` propagates as a real graph failure.

## [1.0.1] — 2026-03-13

### Fixed
- **Token streaming (parallel nodes):** Replaced module-level `_tokenHandler` global with `AsyncLocalStorage` — each node in a parallel fan-out now gets its own token handler, preventing tokens from being silently dropped or misrouted to the wrong node.
- **HITL resume:** `resume()` now looks up the session by `resumeId` (not just the first pending interrupt) and calls `markResumed()` so sessions transition from `"pending"` to `"resumed"` after being handled.
- **Subgraph checkpointer restore:** The child runner's original `checkpointer` is saved before being overwritten with a `NamespacedCheckpointer` and restored after the subgraph completes, preventing the child's checkpointer from leaking across invocations.
- **Circuit breaker fallback:** The user-supplied `fallback(state, error)` is now called with the real node state and the `CircuitBreakerOpenError` instance rather than `(undefined, undefined)`.

## [1.0.0] — 2026-03-13

### Breaking Changes
- `oni-code` AI coding assistant extracted to `@oni.bot/code` (separate package)
- `sentinel` code analysis engine extracted to `@oni.bot/sentinel` (separate package)
- `oni` and `oni-code` CLI binaries removed from this package (install `@oni.bot/code` for the CLI)

### Added
- `./config` sub-module export (`@oni.bot/core/config`) — JSONC config loader with env var substitution and hierarchical merge
- `"sideEffects": false` — enables full tree shaking in bundlers

### Framework
- 5 model adapters (anthropic, openai, openrouter, google, ollama) — zero runtime dependencies
- 21 total exports: root + 20 named subpaths

## [0.7.0] - 2026-03-08

### Added
- Structured error codes with `ONI_<CATEGORY>_<NAME>` taxonomy — every error carries code, category, recoverable flag, suggestion, and context
- Per-node timeouts via `addNode(name, fn, { timeout: ms })` with `NodeTimeoutError`
- Global default timeout via `compile({ defaults: { nodeTimeout: ms } })`
- Circuit breaker pattern: `addNode(name, fn, { circuitBreaker: { threshold, resetAfter, fallback? } })`
- Dead letter queue: `compile({ deadLetterQueue: true })` captures failed node inputs for recovery
- OpenTelemetry tracing adapter (`ONITracer`) — zero-dep, user brings own tracer
- Backpressure streaming with `BoundedBuffer` (drop-oldest and error strategies)
- Testing utilities: `mockModel()`, `assertGraph()`, `createTestHarness()` via `@oni.bot/core/testing`
- `oni init` CLI command for project scaffolding
- 7 new error types: `NodeTimeoutError`, `CircuitBreakerOpenError`, `SwarmDeadlockError`, `ModelRateLimitError`, `ModelContextLengthError`, `CheckpointCorruptError`, `StoreKeyNotFoundError`

### Changed
- `ONIError` now accepts optional `ONIErrorOptions` as second constructor parameter
- All existing error classes enhanced with structured codes (backward compatible)

## [0.6.3] - 2026-03-05

### Added
- `set()` alias for `put()` on `InMemoryStore` and `NamespacedStore`

## [0.6.2] - 2026-03-05

### Fixed
- `createReactAgent` now accepts `ONIModel` (auto-adapts chat to invoke)

### Changed
- Package renamed from `@oni-bot/core` to `@oni.bot/core`

## [0.6.1] - 2026-03-05

### Changed
- Removed all external framework references from codebase and documentation

### Fixed
- Resolved TypeScript strict errors in swarm template `Send` casts

## [0.6.0] - 2026-03-04

### Added
- `SwarmGraph` builder for multi-agent orchestration
- `SwarmGraph.hierarchical()` template — supervisor-workers pattern
- `SwarmGraph.fanOut()` template — parallel agent execution with reducer
- `SwarmGraph.pipeline()` template — linear chain with conditional transitions
- `SwarmGraph.peerNetwork()` template — decentralized agent handoffs
- `SwarmGraph.mapReduce()` template — parallel map with reducer
- `SwarmGraph.debate()` template — multi-round parallel debate with judge
- `SwarmGraph.hierarchicalMesh()` template — nested team coordination
- Lazy coordination auto-wiring (broker and pubsub) on `SwarmGraph`
- Handoff execution — agent `Handoff` returns converted to `Command` routing
- Retry-then-fallback — agents retry on failure, fall back to supervisor

### Changed
- Replaced `SwarmLLM` with `ONIModel` in supervisor routing

## [0.5.0] - 2026-03-04

### Added
- `ONIModel` interface and core LLM types
- Anthropic LLM adapter
- OpenAI LLM adapter
- Ollama LLM adapter
- Google Gemini LLM adapter
- Models export path and re-exports
- Tool framework with `defineTool()` and `ToolContext`
- `AgentContext` and agent types
- `defineAgent()` declarative agent factory
- `agent()` functional agent factory
- `addAgent()` on `StateGraph` to wire agent nodes
- Request/response and pub/sub coordination patterns
- Tool permission guardrails
- Budget tracking and cost control guardrails
- Content filtering guardrails
- Audit trail and guardrails exports
- `EventBus` for structured lifecycle events
- Guardrails and event bus wired into compile/execution pipeline
- Integration tests for agents, tools, and guardrails

### Removed
- Direct `openai` dependency (adapters are now bring-your-own-client)

## [0.4.0] - 2026-03-04

### Added
- `StateGraph` builder with `addNode()`, `addEdge()`, `addConditionalEdges()`
- Pregel execution engine (`ONIPregelRunner`) with parallel superstep execution
- `Command` and `Send` primitives for dynamic routing
- Subgraph support via `addSubgraph()`
- Functional API (`entrypoint`, `task`)
- `MemoryCheckpointer` and `NoopCheckpointer`
- `InMemoryStore` and `NamespacedStore` for shared key-value state
- Human-in-the-loop via `interrupt()` and `getUserInput()`
- Token streaming with `emitToken()` and `TokenStreamWriter`
- Stream modes: `values`, `updates`, `events`, `messages`, `custom`
- Graph inspection via `getGraphDef()`
- `createReactAgent` prebuilt for tool-calling loops
- `ToolNode` prebuilt for automatic tool dispatch
- Messages reducer (`messagesReducer`, `addMessages`, `removeMessages`)
- Retry policies with configurable backoff
- Swarm primitives: `AgentRegistry`, `AgentPool`, `Mailbox`, `Supervisor`
- Ephemeral channel support
- Map-reduce parallel fan-out pattern
