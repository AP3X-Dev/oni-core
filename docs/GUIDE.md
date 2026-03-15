# @oni.bot/core v1.1.0 — Developer Guide

> Progressive tutorial from zero to advanced. Each section builds on the last.
> For complete API signatures, see [API.md](./API.md).

---

## Table of Contents

**Core (Sections 1–8)**

1. [Your First Graph](#1-your-first-graph)
2. [Channels Deep Dive](#2-channels-deep-dive)
3. [Edges and Routing](#3-edges-and-routing)
4. [Streaming](#4-streaming)
5. [Messages](#5-messages)
6. [Checkpointing](#6-checkpointing)
7. [Human-in-the-Loop](#7-human-in-the-loop)
8. [Cross-Thread Store](#8-cross-thread-store)

**Advanced (Sections 9–22)**

9. [Subgraphs](#9-subgraphs)
10. [Parallel Execution](#10-parallel-execution)
11. [Runtime Context](#11-runtime-context)
12. [Retry and Cache](#12-retry-and-cache)
13. [Functional API](#13-functional-api)
14. [Prebuilt Components](#14-prebuilt-components)
15. [Injected Tools](#15-injected-tools)
16. [Graph Inspection](#16-graph-inspection)
17. [Time Travel](#17-time-travel)
18. [Swarm Orchestration](#18-swarm-orchestration)
19. [Error Handling](#19-error-handling)
20. [Production Reliability](#20-production-reliability)
21. [Observability](#21-observability)
22. [Testing](#22-testing)

**Harness (Sections 23–32)**

23. [Harness Overview](#23-harness-overview)
24. [AgentLoop](#24-agentloop)
25. [ONIHarness](#25-oniharness)
26. [Tools in the Harness](#26-tools-in-the-harness)
27. [TodoModule](#27-todomodule)
28. [HooksEngine](#28-hooksengine)
29. [ContextCompactor](#29-contextcompactor)
30. [SafetyGate](#30-safetygate)
31. [SkillLoader](#31-skillloader)
32. [Production Patterns](#32-production-patterns)

---

## 1. Your First Graph

Every @oni.bot/core application follows four steps: define state channels, add nodes, wire edges, compile and run.

### Define your state

State is a plain TypeScript object. Each field needs a **channel** — a reducer that controls how updates merge.

```ts
import { StateGraph, START, END, lastValue, appendList } from "@oni.bot/core";

type MyState = {
  query:  string;
  result: string;
  log:    string[];
};

const graph = new StateGraph<MyState>({
  channels: {
    query:  lastValue(() => ""),     // last write wins
    result: lastValue(() => ""),
    log:    appendList(() => []),     // arrays concatenate
  },
});
```

### Add nodes

Nodes are async functions that receive the full state and return a partial update.

```ts
graph.addNode("search", async (state) => {
  const answer = `Result for: ${state.query}`;
  return { result: answer, log: [`searched: ${state.query}`] };
});
```

### Wire edges

`START` is the entry point. `END` terminates execution.

```ts
graph.addEdge(START, "search");
graph.addEdge("search", END);
```

### Compile and run

```ts
const app = graph.compile();

// invoke — run to completion
const result = await app.invoke({ query: "what is ONI?" });
console.log(result.result); // "Result for: what is ONI?"

// stream — yield events as execution proceeds
for await (const event of app.stream({ query: "hello" })) {
  console.log(event.event, event.node);
}

// batch — run multiple inputs in parallel
const results = await app.batch([{ query: "a" }, { query: "b" }]);
```

---

## 2. Channels Deep Dive

Channels determine how concurrent node outputs merge into state.

### Built-in channel constructors

| Constructor | Behavior | Default |
|---|---|---|
| `lastValue(default)` | Last write wins | Required |
| `appendList(default?)` | Array concatenation | `() => []` |
| `mergeObject(default)` | Shallow object merge | Required |
| `ephemeralValue(default)` | Last write wins, **resets** every superstep | Required |

### Ephemeral channels

Ephemeral channels reset to their default at the start of each superstep. Use them for per-step scratch data that shouldn't persist.

```ts
import { ephemeralValue } from "@oni.bot/core";

const channels = {
  messages:     appendList(() => []),
  totalTokens:  lastValue(() => 0),           // persists
  currentInput: ephemeralValue(() => ""),      // resets each step
  stepFlags:    ephemeralValue(() => ({})),    // resets each step
};
```

### Custom reducers

Any `Channel<T>` is just a `{ reducer, default, ephemeral? }` object. Write your own:

```ts
const maxChannel: Channel<number> = {
  reducer: (current, update) => Math.max(current, update),
  default: () => 0,
};

const uniqueList: Channel<string[]> = {
  reducer: (current, update) => [...new Set([...current, ...update])],
  default: () => [],
};
```

See `examples/ephemeral-channels.ts` for a complete runnable example.

---

## 3. Edges and Routing

### Static edges

Connect nodes in a fixed order. Pass an array to fan out to multiple nodes in parallel.

```ts
graph.addEdge(START, "step_a");
graph.addEdge("step_a", "step_b");
graph.addEdge("step_b", END);

// Fan-out: step_a runs both step_b and step_c in parallel
graph.addEdge("step_a", ["step_b", "step_c"]);
```

### Conditional edges

Route dynamically based on state. The condition function returns a node name (or array for fan-out).

```ts
graph.addConditionalEdges("agent", (state) => {
  if (state.done) return END;
  return "tools";
});

// With pathMap for documentation/visualization
graph.addConditionalEdges("router", (state) => {
  return state.priority === "high" ? "urgent" : "normal";
}, { high: "urgent", low: "normal" });
```

### Command routing

Nodes can return a `Command` to control both state and routing in a single return value:

```ts
import { Command, Send } from "@oni.bot/core";

graph.addNode("classify", async (state) => {
  return new Command({
    update: { status: "classified" },
    goto:   state.isHighRisk ? "escalate" : "approve",
  });
});
```

Commands can also include dynamic fan-out via `Send`:

```ts
return new Command({
  update: { status: "escalated" },
  send: [
    new Send("notify", { channel: "slack" }),
    new Send("notify", { channel: "email" }),
  ],
  goto: "await_decision",
});
```

See `examples/command-routing.ts` for a complete runnable example.

---

## 4. Streaming

### Stream modes

| Mode | What you get |
|---|---|
| `"values"` | Full state snapshot after each superstep |
| `"updates"` | Per-node partial updates only |
| `"debug"` | All internal events (node_start, node_end, state_update, error, interrupt, send) |
| `"messages"` | Token-level message streaming (chunk + accumulated content) |
| `"custom"` | Only custom events emitted via `StreamWriter.emit()` |

```ts
// Single mode (default: "values")
for await (const evt of app.stream(input, { streamMode: "updates" })) {
  console.log(evt.node, evt.data);
}

// Multiple modes simultaneously
for await (const evt of app.stream(input, { streamMode: ["values", "messages"] })) {
  if (evt.mode === "messages") {
    process.stdout.write(evt.data.chunk);
  }
}
```

### Token streaming via getStreamWriter

Inside a node, use `getStreamWriter()` to emit tokens and custom events:

```ts
import { getStreamWriter } from "@oni.bot/core";

graph.addNode("agent", async (state) => {
  const writer = getStreamWriter();
  let fullText = "";

  for await (const chunk of llm.stream(state.messages)) {
    writer?.token(chunk.delta);  // emits "messages" stream event
    fullText += chunk.delta;
  }

  writer?.emit("metrics", { tokens: fullText.length });  // emits "custom" event

  return { answer: fullText };
});
```

### Legacy token streaming

The `emitToken()` function is still supported for backward compatibility:

```ts
import { emitToken } from "@oni.bot/core";

for await (const chunk of llm.stream(messages)) {
  emitToken(chunk.delta);
}
```

### streamEvents v2 protocol

For the v2 event protocol format:

```ts
import { streamEvents } from "@oni.bot/core";

for await (const evt of streamEvents(app, input, config)) {
  // evt.event: "on_chain_start" | "on_chain_end" | "on_chain_error"
  console.log(evt.event, evt.name, evt.data);
}
```

See `examples/messages-stream.ts`, `examples/custom-stream.ts`, and `examples/multi-stream.ts` for complete runnable examples.

---

## 5. Messages

The messages system provides a smart channel with deduplication, removal, and patching.

### Setting up

```ts
import { messagesChannel, messagesStateChannels, humanMessage, aiMessage } from "@oni.bot/core";

// Option A: use the pre-wired state type
type MyState = { messages: Message[]; context: string };
const channels = {
  ...messagesStateChannels,
  context: lastValue(() => ""),
};

// Option B: use MessageGraph for pure chat
import { MessageGraph } from "@oni.bot/core";
const graph = new MessageGraph();  // pre-wired with messages channel
```

### Message helpers

```ts
humanMessage("Hello");                                    // { role: "user", content: "Hello", id: "msg-..." }
aiMessage("Hi!", { tool_calls: [...] });                 // { role: "assistant", ... }
systemMessage("You are a helpful assistant.");           // { role: "system", ... }
toolMessage("result", "call_123");                       // { role: "tool", tool_call_id: "call_123", ... }
```

### Removing and updating messages

```ts
import { RemoveMessage, UpdateMessage } from "@oni.bot/core";

graph.addNode("cleanup", async (state) => ({
  messages: [
    new RemoveMessage("msg-old-id"),
    new UpdateMessage("msg-to-patch", { content: "updated content" }),
  ],
}));
```

### Filtering and trimming

```ts
import { filterByRole, trimMessages, getMessageById } from "@oni.bot/core";

const userMsgs = filterByRole(state.messages, "user");
const trimmed  = trimMessages(state.messages, 20); // keep last 20 (preserves system messages)
const msg      = getMessageById(state.messages, "msg-123");
```

See `examples/messages-reducer.ts` for a complete runnable example.

---

## 6. Checkpointing

Checkpointing saves graph state after each superstep, enabling pause/resume, time travel, and crash recovery.

### Why it matters

Without a checkpointer, execution is fire-and-forget. With one:
- Threads can be paused and resumed
- HITL interrupts work (state is saved before pausing)
- You can inspect or modify state between steps
- Time travel: replay from any historical checkpoint

### Built-in checkpointers

```ts
import { MemoryCheckpointer } from "@oni.bot/core";
import { SqliteCheckpointer, PostgresCheckpointer, NamespacedCheckpointer } from "@oni.bot/core/checkpointers";

// Dev/test: in-memory, full history
const mem = new MemoryCheckpointer();

// On-disk: SQLite (requires: npm install better-sqlite3)
const sqlite = await SqliteCheckpointer.create("./checkpoints.db");

// Production: PostgreSQL (requires: npm install pg)
const pg = await PostgresCheckpointer.create("postgresql://localhost/oni");

// Subgraph isolation: namespaced wrapper
const namespaced = new NamespacedCheckpointer(mem, "my-subgraph");
```

### Wiring into compile

```ts
const app = graph.compile({
  checkpointer: mem,
  interruptAfter: ["agent"],  // optional: pause after agent node
});
```

### Thread lifecycle

A `threadId` identifies a conversation/execution thread:

```ts
// First run
const result = await app.invoke({ query: "hello" }, { threadId: "thread-1" });

// Resume from checkpoint (empty input = continue from saved state)
const result2 = await app.invoke({}, { threadId: "thread-1" });

// Read current state
const state = await app.getState({ threadId: "thread-1" });

// Patch state externally
await app.updateState({ threadId: "thread-1" }, { approved: true });
```

### Checkpoint list filtering

```ts
const checkpoints = await mem.list("thread-1", {
  limit:  10,
  before: 5,                       // only steps before step 5
  filter: { agentId: "researcher" }, // match metadata
});
```

See `examples/time-travel.ts` for a complete runnable example.

---

## 7. Human-in-the-Loop

Two approaches to pausing execution for human input.

### Compile-time interrupts (boundary interrupts)

Pause at node boundaries — before or after specific nodes:

```ts
const app = graph.compile({
  checkpointer: new MemoryCheckpointer(),
  interruptBefore: ["dangerous_node"],
  interruptAfter:  ["agent"],
});

try {
  await app.invoke(input, { threadId: "t1" });
} catch (e) {
  if (e instanceof ONIInterrupt) {
    // Inspect state, patch if needed
    await app.updateState({ threadId: "t1" }, { approved: true });
    // Resume
    const result = await app.invoke({}, { threadId: "t1" });
  }
}
```

### In-node interrupts (runtime interrupts)

Pause at arbitrary points inside node logic using `interrupt()`:

```ts
import { interrupt } from "@oni.bot/core";

graph.addNode("review", async (state) => {
  const decision = await interrupt({
    message: "Approve this action?",
    data:    state.pendingAction,
  });

  return { approved: decision === "approve" };
});
```

When `interrupt()` is called, the Pregel runner checkpoints state and throws an `HITLInterruptException`. Resume via:

```ts
try {
  await app.invoke(input, { threadId: "t1" });
} catch (e) {
  if (e instanceof HITLInterruptException) {
    console.log(e.prompt);  // "Approve this action?"
    // Resume with user response
    const result = await app.resume(
      { threadId: "t1", resumeId: e.interrupt.resumeId },
      "approve"
    );
  }
}
```

### Semantic helpers

```ts
import { getUserInput, getUserApproval, getUserSelection } from "@oni.bot/core";

// Typed input
const name = await getUserInput<string>({
  prompt: "Enter your name:",
  inputType: "text",
});

// Boolean
const ok = await getUserApproval("Deploy to production?");

// Selection from list
const choice = await getUserSelection("Pick an option:", ["A", "B", "C"]);
```

### Dynamic interrupts

Add interrupt conditions at runtime via config:

```ts
await app.invoke(input, {
  threadId: "t1",
  dynamicInterrupts: [{
    node: "agent",
    timing: "after",
    condition: (state) => state.confidence < 0.8,
  }],
});
```

### HITLSessionStore

Track pending interrupt sessions:

```ts
import { HITLSessionStore } from "@oni.bot/core";

const sessions = new HITLSessionStore();
// Sessions are recorded automatically by the Pregel runner
const pending = sessions.getByThread("thread-1");
console.log(pending.length, "interrupts waiting for input");
```

See `examples/hitl/interrupt-basic.ts`, `examples/hitl/user-selection.ts`, and `examples/dynamic-interrupt.ts` for complete runnable examples.

---

## 8. Cross-Thread Store

The Store persists data **across threads**. Unlike checkpointers (per-thread state snapshots), the Store is a shared key-value system with namespaces.

### Namespace model

Data is organized as `(namespace[], key) -> value`:

```
["users", "cj"]       → "preferences" → { theme: "dark" }
["agents", "researcher"] → "facts"    → [...]
```

### Setting up

```ts
import { InMemoryStore } from "@oni.bot/core";

const store = new InMemoryStore();

// Wire into compile
const app = graph.compile({
  checkpointer: mem,
  store: store,
});
```

### Basic operations

```ts
// Write
await store.put(["users", "cj"], "preferences", { theme: "dark" });

// Read
const item = await store.get(["users", "cj"], "preferences");
console.log(item?.value);  // { theme: "dark" }

// List all items in a namespace
const items = await store.list(["users", "cj"]);

// Delete
await store.delete(["users", "cj"], "preferences");
```

### Scoped access with NamespacedStore

```ts
const userStore = store.namespace(["users", "cj"]);

await userStore.put("preferences", { theme: "dark" });
const prefs = await userStore.get("preferences");

// Sub-namespaces
const settingsStore = userStore.namespace(["settings"]);
```

### Semantic search

Pass an `embedFn` to enable vector similarity search:

```ts
const store = new InMemoryStore({
  embedFn: async (text) => myEmbeddingModel.embed(text),
});

await store.put(["kb"], "fact1", "The sky is blue");
await store.put(["kb"], "fact2", "Water boils at 100C");

const results = await store.search(["kb"], "what color is the sky?", { limit: 5 });
// results[0].item.value = "The sky is blue", results[0].score = 0.95
```

### AgentMemoryStore

High-level memory API for agents:

```ts
import { AgentMemoryStore } from "@oni.bot/core";

const memory = new AgentMemoryStore(store, "researcher");

await memory.remember("user_preference", { topic: "AI safety" });
const pref = await memory.recall("user_preference");
const relevant = await memory.search("what does the user like?", 5);
await memory.forget("user_preference");
```

### Listing namespaces

```ts
const namespaces = await store.listNamespaces({ prefix: ["users"], maxDepth: 1 });
// [["users", "cj"], ["users", "alex"], ...]
```

### Accessing store from inside nodes

Use runtime context (see [Section 11](#11-runtime-context)):

```ts
import { getStore } from "@oni.bot/core";

graph.addNode("remember", async (state) => {
  const store = getStore();
  await store?.put(["memory"], "last_query", state.query);
  return {};
});
```

See `examples/store-memory.ts` for a complete runnable example.

---

## 9. Subgraphs

Mount a compiled skeleton as a node inside another graph. Useful for modular agent architectures.

### Adding a subgraph

```ts
const innerGraph = new StateGraph<MyState>({ channels });
innerGraph.addNode("worker", workerFn);
innerGraph.addEdge(START, "worker");
innerGraph.addEdge("worker", END);
const inner = innerGraph.compile();

const outer = new StateGraph<MyState>({ channels });
outer.addSubgraph("inner_agent", inner);
outer.addEdge(START, "inner_agent");
outer.addEdge("inner_agent", END);
```

### State mapping

Subgraphs receive the parent's full state as input and their output is merged back via channels. If the inner graph uses different state keys, adapt with a wrapper node.

### Command.PARENT

A subgraph node can push updates to the parent graph's state:

```ts
import { Command } from "@oni.bot/core";

innerGraph.addNode("worker", async (state) => {
  return new Command({
    update: { parentField: "value from child" },
    graph:  Command.PARENT,  // update goes to parent, not child
  });
});
```

### Checkpoint isolation

Use `NamespacedCheckpointer` to prevent subgraph checkpoints from colliding with parent checkpoints. This is handled automatically when using `addSubgraph()`.

See `examples/subgraph.ts` and `examples/command-parent.ts` for complete runnable examples.

---

## 10. Parallel Execution

### Static fan-out

Pass an array to `addEdge()` to run multiple nodes in parallel:

```ts
graph.addEdge(START, ["research", "analyze", "summarize"]);
```

All three nodes execute concurrently in the same superstep. Their outputs merge via channel reducers.

### Fan-in barrier

After parallel nodes, converge to a single node:

```ts
graph.addEdge("research",  "combine");
graph.addEdge("analyze",   "combine");
graph.addEdge("summarize", "combine");
graph.addEdge("combine", END);
```

The `combine` node only runs once all three complete — the Pregel engine handles the barrier automatically.

### Send API

For dynamic fan-out where the number of parallel tasks isn't known at compile time:

```ts
import { Send } from "@oni.bot/core";

graph.addConditionalEdges("router", (state) =>
  state.items.map(item => new Send("process", { item }))
);
```

Each `Send` creates a parallel execution of the target node with the specified state patch.

### Map-reduce pattern

Combine `Send` for map and a fan-in node for reduce:

```ts
graph.addNode("mapper", async (state) => {
  return { results: [processItem(state.item)] };
});

graph.addNode("reducer", async (state) => {
  return { summary: aggregate(state.results) };
});

graph.addConditionalEdges("splitter", (state) =>
  state.items.map(item => new Send("mapper", { item }))
);
graph.addEdge("mapper", "reducer");
```

See `examples/parallel-fanout.ts`, `examples/send-api.ts`, and `examples/map-reduce.ts` for complete runnable examples.

---

## 11. Runtime Context

Runtime context lets you access config, store, and stream writer from anywhere in the call stack — no need to thread them through function parameters.

All accessors use `AsyncLocalStorage` internally. They throw if called outside a graph node execution.

### getConfig

```ts
import { getConfig } from "@oni.bot/core";

graph.addNode("agent", async (state) => {
  const config = getConfig();
  console.log(config.threadId, config.agentId, config.metadata);
  return {};
});
```

### getStore

```ts
import { getStore } from "@oni.bot/core";

graph.addNode("remember", async (state) => {
  const store = getStore();
  await store?.put(["memory"], "key", state.data);
  return {};
});
```

### getStreamWriter

```ts
import { getStreamWriter } from "@oni.bot/core";

graph.addNode("agent", async (state) => {
  const writer = getStreamWriter();
  writer?.token("streaming...");
  writer?.emit("progress", { step: 1 });
  return {};
});
```

### getCurrentState

```ts
import { getCurrentState } from "@oni.bot/core";

// Access full state from deep helper functions
function helperFn() {
  const state = getCurrentState<MyState>();
  return state.messages.length;
}
```

### getRemainingSteps

```ts
import { getRemainingSteps } from "@oni.bot/core";

graph.addNode("agent", async (state) => {
  const remaining = getRemainingSteps();
  if (remaining < 3) {
    return { answer: "Running low on steps, wrapping up." };
  }
  return {};
});
```

See `examples/runtime-context.ts` for a complete runnable example.

---

## 12. Retry and Cache

### RetryPolicy

Attach a retry policy to any node:

```ts
graph.addNode("flaky_api", apiFn, {
  retry: {
    maxAttempts:       5,
    initialDelay:      1000,    // ms
    backoffMultiplier: 2,       // exponential
    maxDelay:          30_000,  // cap at 30s
    retryOn: (err) => err.message.includes("rate limit"),
  },
});
```

After all attempts are exhausted, a `NodeExecutionError` is thrown with the original error as `cause`.

### withRetry utility

Use standalone for any async function:

```ts
import { withRetry } from "@oni.bot/core";

const result = await withRetry(
  () => fetch("https://api.example.com/data"),
  "api_call",
  { maxAttempts: 3 }
);
```

### CachePolicy

Cache node results to avoid redundant computation:

```ts
graph.addNode("expensive", computeFn, {
  cache: true,  // JSON.stringify(state) as key, per-invocation TTL
});

// Or with custom key + TTL
graph.addNode("expensive", computeFn, {
  cache: {
    key: (state) => state.query,
    ttl: 60_000,  // 60 seconds
  },
});
```

See `examples/retry-policy.ts` for a complete runnable example.

---

## 13. Functional API

An alternative to the builder pattern. Compose graphs from decorated functions.

### task

Wrap a function as a named, reusable unit:

```ts
import { task, entrypoint, lastValue } from "@oni.bot/core";

const search = task("search", async (query: string) => {
  return { results: await searchWeb(query) };
});

const result = await search.invoke("ONI framework");
```

### entrypoint

Create a complete skeleton from a single function:

```ts
type MyState = { query: string; answer: string };

const app = entrypoint(
  { channels: { query: lastValue(() => ""), answer: lastValue(() => "") } },
  async (state) => {
    const answer = await myLLM(state.query);
    return { answer };
  }
);

const result = await app.invoke({ query: "hello" });
```

### pipe

Linear pipeline of functions:

```ts
const app = pipe(
  { channels },
  async (state) => ({ enriched: await enrich(state.query) }),
  async (state) => ({ answer: await respond(state.enriched) }),
  async (state) => ({ formatted: format(state.answer) }),
);
```

### branch

Conditional routing:

```ts
const app = branch(
  (state) => state.lang,
  {
    en: async (state) => ({ answer: await respondEn(state.query) }),
    es: async (state) => ({ answer: await respondEs(state.query) }),
  },
  { channels }
);
```

### HITL in functional API

`interrupt()` and helpers work inside functional API nodes:

```ts
const app = entrypoint({ channels }, async (state) => {
  const approved = await getUserApproval("Deploy?");
  if (!approved) return { status: "aborted" };
  return { status: "deployed" };
});
```

See `examples/functional-api.ts` for a complete runnable example.

---

## 14. Prebuilt Components

### createReactAgent

Factory that wires a complete ReAct (Reason + Act) agent loop:

```ts
import { createReactAgent } from "@oni.bot/core";

const app = createReactAgent({
  llm: myLanguageModel,      // implements ONILanguageModel
  tools: [searchTool, calcTool],
  systemPrompt: "You are a helpful assistant.",
  checkpointer: new MemoryCheckpointer(),
  interruptBefore: ["tools"],  // optional: pause before tool execution
});

const result = await app.invoke({
  messages: [{ role: "user", content: "What's 2+2?" }],
});
```

The wired graph is: `START -> agent <-> tools -> END`. The agent calls the LLM, the LLM returns tool calls, the tool node executes them, results go back to the agent until the LLM returns a final answer.

### ONITool interface

```ts
const searchTool: ONITool = {
  name: "search",
  description: "Search the web",
  schema: { type: "object", properties: { query: { type: "string" } } },
  fn: async (args) => searchWeb(args.query as string),
};
```

### ONILanguageModel interface

Implement for your LLM provider:

```ts
const myLLM: ONILanguageModel = {
  async invoke(messages, config) {
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages,
      tools: config?.tools?.map(t => ({ type: "function", function: t })),
    });
    return response.choices[0].message;
  },
};
```

### toolsCondition

Standard routing function for ReAct loops:

```ts
graph.addConditionalEdges("agent", toolsCondition);
// Returns "tools" if last message has tool_calls, "__end__" otherwise
```

See `examples/react-agent.ts` for a complete runnable example.

---

## 15. Injected Tools

Create tools that automatically receive `state` and `store` from runtime context, hiding injected dependencies from the LLM's tool schema.

```ts
import { createInjectedTool } from "@oni.bot/core";

const memoryTool = createInjectedTool<MyState, { key: string }>({
  name: "remember",
  description: "Save information to memory",
  schema: {
    type: "object",
    properties: { key: { type: "string" } },
  },
  fn: async ({ key }, { state, store }) => {
    await store?.put(["memory"], key, state.currentContext);
    return "Saved!";
  },
});

// When called by the LLM, only { key: "..." } is passed.
// state + store are injected automatically from runtime context.
```

This keeps tool schemas clean for the LLM while giving tools full access to the graph's runtime state and store.

---

## 16. Graph Inspection

Inspect compiled graph topology for visualization, validation, and debugging.

### getGraph / buildGraphDescriptor

```ts
const descriptor = graph.getGraph();

console.log(descriptor.nodes);      // [{ id, type, hasRetry, isSubgraph }, ...]
console.log(descriptor.edges);      // [{ from, to, type, label }, ...]
console.log(descriptor.terminals);  // nodes with no outgoing edges
console.log(descriptor.cycles);     // detected cycles
console.log(descriptor.topoOrder);  // topological sort (null if cyclic)
```

### Mermaid diagrams

```ts
// Basic
const mermaid = graph.toMermaid();

// Detailed with node type styling
const detailed = graph.toMermaidDetailed();
```

Node colors: start=purple, end=dark, subgraph=blue, retry=amber, conditional=gray.

See `examples/graph-inspection.ts` for a complete runnable example.

---

## 17. Time Travel

Requires a checkpointer. Inspect and replay from any historical state.

### Get checkpoint history

```ts
const history = await app.getHistory({ threadId: "t1" });
// Array of ONICheckpoint: [{ step: 0, state, ... }, { step: 1, ... }, ...]
```

### Get state at a specific step

```ts
const pastState = await app.getStateAt({ threadId: "t1", step: 3 });
```

### Fork execution

Create a new thread branching from a historical checkpoint:

```ts
await app.forkFrom({
  threadId:    "t1",
  step:        3,
  newThreadId: "t1-branch",
});

// Continue execution on the fork
const result = await app.invoke({ override: "new data" }, { threadId: "t1-branch" });
```

### Update state externally

Patch the current checkpoint state:

```ts
await app.updateState({ threadId: "t1" }, { approved: true, notes: "LGTM" });
const result = await app.invoke({}, { threadId: "t1" });  // resume with patched state
```

See `examples/time-travel.ts` for a complete runnable example.

---

## 18. Swarm Orchestration

Multi-agent systems with 7 pre-wired templates, structured routing, handoff, and coordination.

### Core concepts

- **SwarmGraph** — extends StateGraph with agent-aware primitives and 7 static template methods
- **SwarmAgentDef** — agent definition (id, role, capabilities, skeleton, maxRetries)
- **Supervisor** — orchestrator node that routes tasks to agents via ONIModel
- **Handoff** — structured inter-agent transfer, auto-converted to Command routing
- **AgentRegistry** — live catalog, supports runtime register/deregister
- **AgentPool** — load-balanced pool of equivalent agents
- **Coordination** — RequestReplyBroker and PubSub, auto-wired (lazy, zero cost until use)
- **Retry-then-fallback** — agents retry N times, then fall back to supervisor

### Template: Hierarchical (Supervisor → Workers)

```ts
import { SwarmGraph } from "@oni.bot/core/swarm";

const swarm = SwarmGraph.hierarchical<MySwarmState>({
  supervisor: {
    model: myModel,
    strategy: "llm",
    systemPrompt: "Route tasks to the best agent.",
    maxRounds: 10,
  },
  agents: [researcher, writer, critic],
  onError: "fallback",
});

const app = swarm.compile({ checkpointer: mem });
const result = await app.invoke({ task: "Write a blog post about AI" });
```

### Template: Fan-Out (Parallel + Aggregation)

```ts
const swarm = SwarmGraph.fanOut<ResearchState>({
  agents: [webResearcher, paperResearcher, newsResearcher],
  reducer: (results) => ({
    synthesis: `Combined from ${Object.keys(results).length} sources`,
    allFindings: results,
  }),
});
```

### Template: Pipeline (Sequential Chain)

```ts
const swarm = SwarmGraph.pipeline<DocState>({
  stages: [planner, coder, reviewer],
  transitions: {
    reviewer: (state) => state.approved ? END : "coder",
  },
});
```

### Template: Peer Network (Agent-to-Agent)

```ts
const swarm = SwarmGraph.peerNetwork<TeamState>({
  agents: [planner, coder, reviewer, tester],
  entrypoint: "planner",
  handoffs: {
    planner:  (state) => "coder",
    coder:    (state) => "reviewer",
    reviewer: (state) => state.approved ? "tester" : "coder",
    tester:   (state) => state.passing ? END : "coder",
  },
});
```

### Template: Map-Reduce (Pool Distribution)

```ts
const swarm = SwarmGraph.mapReduce<AnalysisState>({
  mapper: analyst,
  poolSize: 3,
  poolStrategy: "least-busy",
  inputField: "documents",
  reducer: (results) => ({
    summary: results.map(r => r.finding).join("\n"),
  }),
});
```

### Template: Debate (Multi-Round Argumentation)

```ts
const swarm = SwarmGraph.debate<DebateState>({
  debaters: [optimist, pessimist, realist],
  judge: {
    model: myModel,
    systemPrompt: "Evaluate arguments and decide if consensus is reached.",
    maxRounds: 5,
  },
  topic: "taskField",
});
```

### Template: Hierarchical Mesh (Nested Teams)

```ts
const swarm = SwarmGraph.hierarchicalMesh<OrgState>({
  coordinator: { model: myModel, strategy: "llm" },
  teams: {
    research: {
      topology: "pipeline",
      agents: [searcher, synthesizer],
    },
    engineering: {
      topology: "peerNetwork",
      agents: [architect, coder, reviewer],
      handoffs: { /* routing rules */ },
    },
  },
});
```

### All Templates at a Glance

| Template | Pattern | Use case |
|---|---|---|
| `hierarchical()` | Supervisor → Workers → Supervisor | Task delegation with oversight |
| `fanOut()` | Send to all → Reduce | Parallel research/analysis |
| `pipeline()` | A → B → C → END | Sequential processing |
| `peerNetwork()` | Dynamic handoffs | Collaborative peer teams |
| `mapReduce()` | Split → Pool → Reduce | Batch processing with load balancing |
| `debate()` | Judge ↔ Debaters (rounds) | Consensus-driven decision making |
| `hierarchicalMesh()` | Coordinator → Team subgraphs | Organization-level orchestration |

### Supervisor routing strategies

| Strategy | Description |
|---|---|
| `"llm"` | ONIModel picks the best agent from capabilities manifest |
| `"rule"` | Deterministic: `condition(task, context) -> agentId` |
| `"round-robin"` | Cycle through available agents in order |
| `"capability"` | Match `context.requiredCapabilities` to agent capability names |

### Error recovery

Agents retry automatically (default 2 attempts). After retries exhausted, control returns to the supervisor with error context. The supervisor excludes the failed agent from the next routing decision.

### Manual API (Advanced)

For custom topologies not covered by templates, use the manual API:

```ts
const swarm = new SwarmGraph<MySwarmState>();
swarm.addAgent(researcherDef);
swarm.addAgent(writerDef);
swarm.addSupervisor({ model: myModel, strategy: "llm", taskField: "task" });
swarm.addConditionalHandoff("reviewer", (state) => state.approved ? END : "coder");
```

### Swarm extensions

The compiled swarm skeleton includes extra methods:

```ts
const app = swarm.compile();
console.log(app.registry);     // live AgentRegistry
console.log(app.agentStats()); // { agentId: { status, activeTasks, totalRuns, errors } }
console.log(app.toMermaid());  // graph visualization

// Runtime agent management (requires a supervisor topology)
app.spawnAgent(newAgentDef);   // add a new agent to a running swarm
app.removeAgent("agent-id");   // deregister and clean up routing edges
```

`spawnAgent()` and `removeAgent()` are safe to call between `invoke()` calls. `removeAgent()` intercepts any conditional edge that could route to the removed agent — including pathMap-based routes — redirecting to `END` instead of throwing.

See `examples/swarm/hierarchical.ts`, `examples/swarm/peer-network.ts`, `examples/swarm/fan-out.ts`, `examples/swarm/map-reduce.ts`, `examples/swarm/debate.ts`, `examples/swarm/hierarchical-mesh.ts`, and `examples/swarm/coordination-demo.ts` for complete runnable examples.

---

## 19. Error Handling

### Error hierarchy

All ONI errors extend `ONIError`:

| Error | When |
|---|---|
| `ONIError` | Base class |
| `InvalidSkeletonError` | Graph validation fails (no START edge, reserved names, duplicate nodes) |
| `RecursionLimitError` | Superstep count exceeds `recursionLimit` (default 25) |
| `NodeNotFoundError` | Edge references a non-existent node |
| `EdgeConflictError` | Duplicate static edge added |
| `NodeExecutionError` | Node failed after all retry attempts. `.cause` has the original error |

### ONIInterrupt vs HITLInterruptException

These are two different interrupt mechanisms:

| Type | Trigger | Caught by |
|---|---|---|
| `ONIInterrupt` | Compile-time `interruptBefore`/`interruptAfter` | External try/catch |
| `HITLInterruptException` | Runtime `interrupt()` call inside a node | External try/catch |

```ts
try {
  await app.invoke(input, { threadId: "t1" });
} catch (e) {
  if (e instanceof ONIInterrupt) {
    // Boundary interrupt: inspect e.node, e.timing, e.state
  }
  if (e instanceof HITLInterruptException) {
    // In-node interrupt: inspect e.interrupt, e.prompt, e.state
  }
}
```

### Patterns

**Catch and recover:**
```ts
graph.addNode("safe_api", async (state) => {
  try {
    const data = await riskyApi(state.query);
    return { result: data };
  } catch (err) {
    return { result: null, error: err.message };
  }
});
```

**Retry with policy (preferred):**
```ts
graph.addNode("api", apiFn, {
  retry: { maxAttempts: 3, retryOn: (e) => e.message.includes("timeout") },
});
```

**Recursion safety:**
```ts
const result = await app.invoke(input, { recursionLimit: 50 });
// Throws RecursionLimitError if 50 supersteps are exceeded
```

**Error in stream:**
```ts
for await (const evt of app.stream(input, { streamMode: "debug" })) {
  if (evt.event === "error") {
    console.error("Node error:", evt.node, evt.data);
  }
}
```

---

## 20. Production Reliability

ONI provides three layered safeguards that compose with retry policies to protect production workloads: node timeouts, circuit breakers, and a dead letter queue.

### Execution pipeline

When a node executes, safeguards are evaluated in this order:

```
Circuit Breaker → Timeout → Retry → Node Function
```

1. **Circuit breaker** — if the breaker is open (too many recent failures), the call is rejected immediately without running the node.
2. **Timeout** — if the node does not resolve within the time limit, it is aborted and treated as a failure.
3. **Retry** — transient failures are retried according to the node's retry policy (see [Section 12](#12-retry-and-cache)).

If all retry attempts are exhausted and a dead letter queue is enabled, the failed invocation is recorded there instead of crashing the graph.

### Node timeouts

Prevent runaway nodes from blocking execution indefinitely:

```ts
graph.addNode("llm_call", callLLM, {
  timeout: 30_000, // abort after 30 seconds
});
```

When the timeout fires, the node receives a `NodeExecutionError` with `cause.code === "TIMEOUT"`. This error feeds into the retry pipeline — so a timed-out call can be retried automatically if a retry policy is attached:

```ts
graph.addNode("llm_call", callLLM, {
  timeout: 30_000,
  retry: { maxAttempts: 3, initialDelay: 1000 },
});
```

### Circuit breakers

Protect downstream services from being overwhelmed after repeated failures:

```ts
graph.addNode("payment_api", chargeCard, {
  circuitBreaker: {
    threshold:  5,       // open after 5 consecutive failures
    resetAfter: 60_000,  // try again after 60 seconds (half-open)
  },
});
```

Circuit breaker states:

| State | Behavior |
|---|---|
| **Closed** | Requests flow through normally. Failures increment the counter. |
| **Open** | All requests are rejected immediately with a `CircuitOpenError`. |
| **Half-open** | After `resetAfter` ms, one probe request is allowed. If it succeeds, the breaker closes; if it fails, it re-opens. |

When a circuit breaker and retry are both configured, the breaker wraps the entire retry sequence — if the breaker is open, no retries are attempted.

### Dead letter queue

Capture failed invocations for later inspection or replay instead of losing them:

```ts
const app = graph.compile({
  checkpointer: mem,
  deadLetterQueue: true,
});
```

Failed node executions (after all retries are exhausted) are recorded with full context:

```ts
// Retrieve dead letters for a thread
const deadLetters = await app.getDeadLetters({ threadId: "t1" });

for (const entry of deadLetters) {
  console.log(entry.node);       // which node failed
  console.log(entry.error);      // the final error
  console.log(entry.state);      // state snapshot at time of failure
  console.log(entry.timestamp);  // when it failed
  console.log(entry.attempts);   // how many attempts were made
}
```

### Composing all three

A production-hardened node typically combines all three safeguards:

```ts
graph.addNode("external_api", callExternalService, {
  timeout: 15_000,
  circuitBreaker: { threshold: 3, resetAfter: 30_000 },
  retry: {
    maxAttempts: 3,
    initialDelay: 500,
    backoffMultiplier: 2,
    retryOn: (err) => err.code !== "VALIDATION_ERROR", // don't retry bad input
  },
});

const app = graph.compile({
  checkpointer: mem,
  deadLetterQueue: true,
});
```

Execution flow for this node:
1. Circuit breaker checks whether the circuit is closed/half-open.
2. The node runs with a 15-second timeout.
3. On failure, the retry policy retries up to 3 times with exponential backoff.
4. If all attempts fail, the circuit breaker increments its failure counter.
5. The failed invocation is written to the dead letter queue.

---

## 21. Observability

### Structured errors

All ONI errors carry machine-readable metadata for logging and alerting:

```ts
import { ONIError, NodeExecutionError } from "@oni.bot/core";

try {
  await app.invoke(input);
} catch (err) {
  if (err instanceof ONIError) {
    console.log(err.code);       // "NODE_EXECUTION_ERROR"
    console.log(err.category);   // "execution" | "validation" | "timeout" | "circuit"
    console.log(err.toJSON());   // { code, category, message, node?, cause?, timestamp }
  }
}
```

Error categories:

| Category | Error types |
|---|---|
| `"validation"` | `InvalidSkeletonError`, `NodeNotFoundError`, `EdgeConflictError` |
| `"execution"` | `NodeExecutionError`, `RecursionLimitError` |
| `"timeout"` | `NodeExecutionError` with `cause.code === "TIMEOUT"` |
| `"circuit"` | `CircuitOpenError` |
| `"interrupt"` | `ONIInterrupt`, `HITLInterruptException` |

The `toJSON()` method produces a plain object suitable for structured logging (e.g., JSON logs ingested by Datadog, Splunk, or ELK):

```ts
graph.addNode("agent", agentFn, {
  retry: { maxAttempts: 3 },
});

// In your error handler / catch block:
logger.error(err.toJSON());
// {
//   code: "NODE_EXECUTION_ERROR",
//   category: "execution",
//   message: "Node \"agent\" failed after 3 attempts",
//   node: "agent",
//   cause: { message: "Connection refused", ... },
//   timestamp: "2026-03-08T12:00:00.000Z"
// }
```

### OpenTelemetry tracing

ONI integrates with OpenTelemetry via `ONITracer`. Pass your own OTel tracer and ONI will create spans for graph invocations, supersteps, and individual node executions.

#### Setup

```ts
import { ONITracer } from "@oni.bot/core";
import { trace } from "@opentelemetry/api";

// Use your application's OTel tracer
const otelTracer = trace.getTracer("my-app", "1.0.0");
const oniTracer = new ONITracer(otelTracer);
```

#### Instrumenting a graph

Pass the tracer at compile time to instrument all executions:

```ts
const app = graph.compile({
  checkpointer: mem,
  tracer: oniTracer,
});
```

Every `invoke()` or `stream()` call now produces a span tree:

```
oni.graph.invoke (root span)
├── oni.superstep.0
│   └── oni.node.agent
├── oni.superstep.1
│   ├── oni.node.tool_a
│   └── oni.node.tool_b
└── oni.superstep.2
    └── oni.node.agent
```

#### Span attributes

Each span includes structured attributes:

| Span | Attributes |
|---|---|
| `oni.graph.invoke` | `threadId`, `input_keys`, `stream_mode` |
| `oni.superstep.N` | `step_number`, `node_count` |
| `oni.node.<name>` | `node_name`, `duration_ms`, `has_retry`, `retry_attempt` |

#### Full example

```ts
import { StateGraph, START, END, lastValue, ONITracer, MemoryCheckpointer } from "@oni.bot/core";
import { trace } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

// 1. Initialize OpenTelemetry SDK (application-level setup)
const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: "http://localhost:4318/v1/traces" }),
  serviceName: "my-oni-app",
});
sdk.start();

// 2. Create the ONI tracer
const oniTracer = new ONITracer(trace.getTracer("my-oni-app"));

// 3. Build a graph
type State = { query: string; answer: string };
const graph = new StateGraph<State>({
  channels: {
    query:  lastValue(() => ""),
    answer: lastValue(() => ""),
  },
});

graph.addNode("agent", async (state) => {
  const answer = await callLLM(state.query);
  return { answer };
}, { timeout: 30_000 });

graph.addEdge(START, "agent");
graph.addEdge("agent", END);

// 4. Compile with tracer
const app = graph.compile({
  checkpointer: new MemoryCheckpointer(),
  tracer: oniTracer,
});

// 5. Run — spans are exported automatically
const result = await app.invoke({ query: "What is ONI?" });
```

Spans are exported to your configured OTel collector (Jaeger, Zipkin, Grafana Tempo, Datadog, etc.) with no additional code.

---

## 22. Testing

ONI ships with testing utilities that make it straightforward to write deterministic tests for your graphs without calling real LLMs or external services.

### mockModel

Create a mock language model that returns canned responses in sequence:

```ts
import { mockModel } from "@oni.bot/core/testing";

const model = mockModel([
  // First call returns a plain text response
  { content: "I'll search for that." },
  // Second call returns a tool call
  {
    content: "",
    tool_calls: [{ id: "call_1", function: { name: "search", arguments: '{"q":"ONI"}' } }],
  },
  // Third call returns the final answer
  { content: "ONI is a graph execution framework." },
]);
```

Each `invoke()` or `stream()` call on the mock consumes the next response. If all responses are exhausted, subsequent calls throw an error.

The mock also records every call for assertions:

```ts
console.log(model.calls.length);       // number of calls made
console.log(model.calls[0].messages);  // messages passed to the first call
console.log(model.calls[0].tools);     // tools passed to the first call
```

### assertGraph

Validate graph structure before running it. Catches wiring mistakes at test time:

```ts
import { assertGraph } from "@oni.bot/core/testing";

// Throws with a descriptive message if validation fails
assertGraph(graph, {
  hasNode:       "agent",                         // node exists
  hasEdge:       [START, "agent"],                // edge exists
  nodeCount:     3,                               // exact node count
  isAcyclic:     false,                           // cycles are expected (agent loop)
  allReachable:  true,                            // every node is reachable from START
  terminates:    true,                            // at least one path reaches END
});
```

You can also use individual checks:

```ts
assertGraph(graph, { hasNode: "agent" });
assertGraph(graph, { hasEdge: ["agent", "tools"] });
assertGraph(graph, { allReachable: true });
```

### createTestHarness

Create an isolated test environment with an in-memory checkpointer and store, pre-wired for testing:

```ts
import { createTestHarness } from "@oni.bot/core/testing";

const harness = createTestHarness(graph, {
  model: mockModel([...]),   // optional: inject a mock model
  store: new InMemoryStore(), // optional: provide a pre-loaded store
});

// harness.app       — compiled skeleton, ready to invoke
// harness.checkpoint — MemoryCheckpointer (inspect state between steps)
// harness.store      — the store instance
// harness.model      — the mock model (access .calls for assertions)
```

The harness compiles the graph with all test infrastructure wired in, so you do not need to manage checkpointers or stores manually.

### Full example: testing a multi-step ReAct agent

```ts
import { describe, it, expect } from "vitest";
import {
  StateGraph, START, END, lastValue, appendList,
  createReactAgent, messagesStateChannels,
  humanMessage,
} from "@oni.bot/core";
import { mockModel, createTestHarness, assertGraph } from "@oni.bot/core/testing";

describe("research agent", () => {
  // Define tools
  const searchTool = {
    name: "search",
    description: "Search the web",
    schema: { type: "object", properties: { q: { type: "string" } } },
    fn: async (args: { q: string }) => `Results for: ${args.q}`,
  };

  // Create a mock that simulates a tool-calling loop
  const model = mockModel([
    // Step 1: agent decides to search
    {
      content: "",
      tool_calls: [{
        id: "call_1",
        function: { name: "search", arguments: '{"q":"ONI framework"}' },
      }],
    },
    // Step 2: agent synthesizes the tool result into a final answer
    { content: "ONI is a TypeScript graph execution framework." },
  ]);

  const agent = createReactAgent({
    llm: model,
    tools: [searchTool],
    systemPrompt: "You are a research assistant.",
  });

  it("should have correct graph structure", () => {
    assertGraph(agent, {
      hasNode:      "agent",
      hasNode2:     "tools",
      hasEdge:      [START, "agent"],
      allReachable: true,
      terminates:   true,
    });
  });

  it("should call search and return a final answer", async () => {
    const harness = createTestHarness(agent, { model });
    const result = await harness.app.invoke({
      messages: [humanMessage("Tell me about ONI")],
    });

    // Verify the final message
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.content).toContain("graph execution framework");

    // Verify the model was called twice (tool call + final answer)
    expect(model.calls).toHaveLength(2);

    // Verify the search tool was invoked with the right query
    expect(model.calls[0].tools).toBeDefined();
    expect(model.calls[0].tools![0].name).toBe("search");
  });

  it("should save results to store when configured", async () => {
    const harness = createTestHarness(agent, { model });
    await harness.app.invoke(
      { messages: [humanMessage("Search for ONI")] },
      { threadId: "test-thread" },
    );

    // Inspect checkpointed state
    const state = await harness.app.getState({ threadId: "test-thread" });
    expect(state.messages.length).toBeGreaterThan(1);
  });
});
```

### Tips for effective graph testing

- **One mock per test** — create a fresh `mockModel` for each test case to avoid shared state between tests.
- **Use `assertGraph` early** — structural validation catches wiring bugs before you write execution tests.
- **Inspect `model.calls`** — verify that your graph passes the right messages and tools to the LLM at each step.
- **Test error paths** — use `mockModel` responses that trigger retries or fallbacks, combined with node timeout and circuit breaker options, to verify your graph's resilience logic.
- **Use the harness** — `createTestHarness` eliminates boilerplate and ensures each test runs in isolation with its own checkpointer and store.

---

## 23. Harness Overview

ONI's architecture has two layers: the **swarm layer** (Sections 1–22) handles macro-level graph orchestration — nodes, edges, supersteps, checkpointing — while the **harness layer** handles micro-level agent execution within a single node. The harness drives a single agent through a think-act-observe loop, managing tool execution, context compaction, safety checks, working memory, skill injection, and lifecycle hooks.

Use the swarm layer when you need multi-agent graphs with explicit routing. Use the harness layer when a single agent node needs to run autonomously for many turns — calling tools, managing its own context window, and staying on task across long sessions. The two layers compose naturally: `ONIHarness.asNode()` wraps a harness-driven agent as a standard graph node.

```ts
import { ONIHarness } from "@oni.bot/core";
import { anthropic } from "@oni.bot/core/models";

// Create a harness with a primary model and a fast model for safety/compaction
const harness = ONIHarness.create({
  model: anthropic("claude-sonnet-4-20250514"),
  fastModel: anthropic("claude-haiku-4-5-20251001"),
  soul: "You are a helpful coding assistant.",
  maxTurns: 20,
});

// Run the agent — returns an async generator of LoopMessages
for await (const msg of harness.run("Refactor the auth module", "coder")) {
  if (msg.type === "assistant") console.log(msg.content);
  if (msg.type === "result") console.log("Final:", msg.content);
}
```

### Two-layer architecture at a glance

| Layer | Scope | Key abstractions |
|---|---|---|
| **Swarm** (StateGraph) | Multi-agent orchestration | Nodes, edges, channels, supersteps |
| **Harness** (AgentLoop) | Single-agent autonomy | Turns, tool calls, compaction, hooks |

---

## 24. AgentLoop

The `agentLoop()` function is an async generator that drives one agent through a **think-act-observe** cycle. Each iteration calls the model (think), executes any tool calls (act), and feeds results back (observe). The generator yields `LoopMessage` objects at each step, giving the caller full visibility into the agent's operation.

The loop runs until the model produces a response with no tool calls (natural stop), the `maxTurns` limit is reached, or the `AbortSignal` fires. Between turns, it checks for context compaction, fires lifecycle hooks, injects skill instructions, and refreshes the TODO reminder.

```ts
import { agentLoop } from "@oni.bot/core";
import { anthropic } from "@oni.bot/core/models";
import { defineTool } from "@oni.bot/core/tools";

const readFileTool = defineTool({
  name: "ReadFile",
  description: "Read a file from disk",
  schema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  execute: async (input) => {
    const fs = await import("fs/promises");
    return fs.readFile(input.path, "utf-8");
  },
});

const controller = new AbortController();

for await (const msg of agentLoop("Read package.json and summarize it", {
  model: anthropic("claude-sonnet-4-20250514"),
  tools: [readFileTool],
  agentName: "file-reader",
  systemPrompt: "You are a helpful file reader.",
  maxTurns: 10,
  signal: controller.signal,
  env: {
    cwd: process.cwd(),
    platform: process.platform,
    date: new Date().toISOString().split("T")[0],
  },
})) {
  switch (msg.type) {
    case "system":
      console.log(`[system] ${msg.subtype}: ${msg.content}`);
      break;
    case "assistant":
      console.log(`[assistant] ${msg.content?.slice(0, 100)}...`);
      if (msg.toolCalls) {
        console.log(`  tool calls: ${msg.toolCalls.map((t) => t.name).join(", ")}`);
      }
      break;
    case "tool_result":
      for (const tr of msg.toolResults ?? []) {
        console.log(`  [${tr.toolName}] ${tr.isError ? "ERROR" : "OK"}`);
      }
      break;
    case "result":
      console.log(`\nFinal answer:\n${msg.content}`);
      break;
    case "error":
      console.error(`Error: ${msg.content}`);
      break;
  }
}
```

### LoopMessage protocol

Every yielded message follows this structure:

| Field | Type | Description |
|---|---|---|
| `type` | `"system" \| "assistant" \| "tool_result" \| "result" \| "error"` | Message category |
| `sessionId` | `string` | Unique session identifier |
| `turn` | `number` | Current turn number (0-based) |
| `timestamp` | `number` | `Date.now()` when the message was created |
| `content` | `string?` | Text content (assistant response, error message, etc.) |
| `toolCalls` | `ONIModelToolCall[]?` | Tool calls from the model (on `assistant` messages) |
| `toolResults` | `LoopToolResult[]?` | Results from tool execution (on `tool_result` messages) |
| `subtype` | `string?` | Sub-classification (`"init"`, `"compact_boundary"`, `"todo_reminder"`) |
| `metadata` | `Record<string, unknown>?` | Usage stats, stop reason, total turns |

### AgentLoopConfig key options

- **`model`** — the `ONIModel` instance to use for inference
- **`tools`** — array of `ToolDefinition` objects available to the agent
- **`agentName`** — name used in session IDs and hook payloads
- **`systemPrompt`** — injected as the system message on every inference call
- **`maxTurns`** — upper bound on think-act-observe iterations (default: 10)
- **`signal`** — `AbortSignal` for cooperative cancellation
- **`env`** — environment info (cwd, platform, date, git branch/status) appended to the system prompt
- **`todoModule`**, **`hooksEngine`**, **`compactor`**, **`safetyGate`**, **`skillLoader`** — optional module instances wired automatically by `ONIHarness`

### wrapWithAgentLoop

The `wrapWithAgentLoop()` helper wraps an `AgentLoopConfig` into a standard graph node function. It reads `state.task` or `state.context` as the prompt, runs the loop to completion, and writes the result into `state.agentResults[agentName]`.

```ts
import { StateGraph, START, END, lastValue, appendList } from "@oni.bot/core";
import { wrapWithAgentLoop } from "@oni.bot/core";
import { anthropic } from "@oni.bot/core/models";

type State = {
  task: string;
  agentResults: Record<string, string>;
};

const graph = new StateGraph<State>({
  channels: {
    task: lastValue(() => ""),
    agentResults: lastValue(() => ({})),
  },
});

graph.addNode("researcher", wrapWithAgentLoop({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: [],
  agentName: "researcher",
  systemPrompt: "You are a research agent. Analyze the task thoroughly.",
  maxTurns: 5,
}));

graph.addEdge(START, "researcher");
graph.addEdge("researcher", END);

const app = graph.compile();
const result = await app.invoke({ task: "Analyze market trends in AI" });
console.log(result.agentResults.researcher);
```

---

## 25. ONIHarness

`ONIHarness` is the integration class that wires all harness modules together — TodoModule, HooksEngine, ContextCompactor, SafetyGate, and SkillLoader — and provides clean APIs for running agents or bridging into the swarm layer. Create one harness per application and use it to spawn multiple agent sessions.

The constructor is private; use the static `ONIHarness.create()` factory. The harness automatically composes security guardrails with your custom hooks, routes the fast model to safety and compaction subsystems, and loads skills from disk.

```ts
import { ONIHarness } from "@oni.bot/core";
import { anthropic } from "@oni.bot/core/models";
import { defineTool } from "@oni.bot/core/tools";

const searchTool = defineTool({
  name: "Search",
  description: "Search the knowledge base",
  schema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  execute: async (input) => `Results for: ${input.query}`,
});

const harness = ONIHarness.create({
  model: anthropic("claude-sonnet-4-20250514"),
  fastModel: anthropic("claude-haiku-4-5-20251001"),
  sharedTools: [searchTool],
  soul: "You are a knowledgeable assistant. Always cite sources.",
  hooks: {
    PostToolUse: [{
      handler: async (payload) => {
        console.log(`Tool ${payload.toolName} took ${payload.durationMs}ms`);
        return { decision: "allow" };
      },
    }],
  },
  compaction: {
    threshold: 0.60,
    maxTokens: 200_000,
  },
  safety: {
    protectedTools: ["Bash", "Write"],
    timeout: 3000,
  },
  skillPaths: ["./skills"],
  maxTurns: 30,
});
```

### run() — streaming

Returns an async generator of `LoopMessage` objects. Pass either an `AgentNodeConfig` object or a plain agent name string.

```ts
for await (const msg of harness.run("Explain quantum computing", {
  name: "explainer",
  soul: "You explain complex topics simply.",
  maxTurns: 5,
})) {
  if (msg.type === "result") {
    console.log(msg.content);
  }
}
```

### runToResult() — convenience

Collects the full loop and returns only the final result string.

```ts
const answer = await harness.runToResult(
  "What is the capital of France?",
  "assistant",
);
console.log(answer); // "The capital of France is Paris."
```

### asNode() — graph integration

Wraps a harness agent as a standard graph node function for use inside a `StateGraph`. The node reads `state.task` as the prompt and writes its result to `state.agentResults[name]`.

```ts
import { StateGraph, START, END, lastValue } from "@oni.bot/core";

type PipelineState = {
  task: string;
  agentResults: Record<string, string>;
  summary: string;
};

const graph = new StateGraph<PipelineState>({
  channels: {
    task: lastValue(() => ""),
    agentResults: lastValue(() => ({})),
    summary: lastValue(() => ""),
  },
});

// Use harness-powered agents as graph nodes
graph.addNode("researcher", harness.asNode({
  name: "researcher",
  soul: "You are a thorough researcher.",
  tools: [searchTool],
  maxTurns: 15,
}));

graph.addNode("writer", harness.asNode({
  name: "writer",
  soul: "You are a concise technical writer.",
  maxTurns: 10,
}));

graph.addEdge(START, "researcher");
graph.addEdge("researcher", "writer");
graph.addEdge("writer", END);

const app = graph.compile();
const result = await app.invoke({ task: "Write a brief on AI safety" });
```

### Harness agents in swarm topologies

Use `harness.asNode()` to wrap a harness-driven agent as a standard graph node, then mount it inside a `SwarmAgentDef` skeleton. This is the correct way to combine the harness (micro) and swarm (macro) layers.

```ts
import { SwarmGraph, baseSwarmChannels } from "@oni.bot/core/swarm";
import type { BaseSwarmState, SwarmAgentDef } from "@oni.bot/core/swarm";
import { StateGraph, START, END } from "@oni.bot/core";

function buildHarnessAgent(
  id: string,
  soul: string,
  tools: ToolDefinition[] = [],
): SwarmAgentDef<BaseSwarmState> {
  // Wrap the harness loop as a graph node
  const node = harness.asNode<BaseSwarmState>({ name: id, soul, tools, maxTurns: 5 });

  // Mount it in a single-node StateGraph to produce a skeleton
  const g = new StateGraph<BaseSwarmState>({ channels: baseSwarmChannels });
  g.addNode("work", node);
  g.addEdge(START, "work");
  g.addEdge("work", END);

  return {
    id,
    role: id,
    capabilities: [{ name: id, description: soul }],
    skeleton: g.compile(),
  };
}

const researcher = buildHarnessAgent("researcher", "You research topics thoroughly.", [searchTool]);
const writer     = buildHarnessAgent("writer",     "You write clear technical content.");

const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
  supervisor: { model: myModel, strategy: "llm", maxRounds: 10 },
  agents: [researcher, writer],
});
```

See `examples/harness/architecture-debate.ts` and `examples/harness/research-team.ts` for complete runnable examples.

### Key API

- **`ONIHarness.create(config)`** — static factory, creates all internal modules
- **`run(prompt, agent)`** — async generator of `LoopMessage`
- **`runToResult(prompt, agent)`** — returns `Promise<string>`
- **`asNode(agentConfig)`** — returns `(state) => Promise<Partial<State>>`
- **`asSwarmAgent(name, soul, tools?, opts?)`** — returns `SwarmAgentCompat`
- **`getTodoModule()`** / **`getHooksEngine()`** / **`getSkillLoader()`** — access internal modules
- **`registerSkill(skill)`** — register a skill at runtime
- **`addHooks(config)`** — add hooks after creation

---

## 26. Tools in the Harness

Tools in the harness layer use the same `defineTool()` function and `ToolDefinition` interface as the swarm layer, but the harness extends the tool execution context with session-aware fields. When a tool runs inside the agent loop, its `ToolContext` is actually a `HarnessToolContext` — providing access to `sessionId`, `threadId`, `agentName`, `turn`, and `signal` in addition to the standard `config`, `store`, `state`, and `emit`.

This extended context enables tools to participate in session lifecycle, check the abort signal for cooperative cancellation, and correlate their actions with the agent that invoked them.

```ts
import { defineTool } from "@oni.bot/core/tools";
import type { HarnessToolContext } from "@oni.bot/core";

const auditedWriteTool = defineTool({
  name: "WriteFile",
  description: "Write content to a file with audit logging",
  schema: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
  execute: async (input, ctx) => {
    // Cast to HarnessToolContext when running inside the harness
    const hctx = ctx as HarnessToolContext;

    // Check abort signal before expensive operation
    if (hctx.signal?.aborted) {
      throw new Error("Operation cancelled");
    }

    // Use session-aware fields for audit logging
    console.log(`[${hctx.agentName}] session=${hctx.sessionId} turn=${hctx.turn}`);
    console.log(`Writing to ${input.path}`);

    const fs = await import("fs/promises");
    await fs.writeFile(input.path, input.content, "utf-8");

    return `Wrote ${input.content.length} characters to ${input.path}`;
  },
});
```

### Tool execution flow inside the agent loop

When the model returns tool calls, each call passes through this pipeline:

1. **PreToolUse hook** — hooks can deny the call or modify its input
2. **SafetyGate check** — protected tools are sent to the fast model for approval
3. **Tool lookup** — the tool is found by name in the registered tools map
4. **Execution** — `tool.execute(args, harnessToolContext)` is called
5. **PostToolUse hook** — hooks observe the result and duration
6. **Error handling** — on failure, `PostToolUseFailure` fires and the error is returned to the model

### Sharing tools across agents

Use `sharedTools` in `HarnessConfig` for tools available to all agents, and per-agent `tools` in `AgentNodeConfig` for specialized tools:

```ts
import { ONIHarness } from "@oni.bot/core";
import { anthropic } from "@oni.bot/core/models";

const harness = ONIHarness.create({
  model: anthropic("claude-sonnet-4-20250514"),
  sharedTools: [readFileTool, searchTool],  // available to every agent
});

// This agent gets shared tools + its own specialized tool
for await (const msg of harness.run("Deploy the app", {
  name: "deployer",
  tools: [deployTool],  // agent-specific tool
})) {
  // deployer can use readFileTool, searchTool, AND deployTool
}
```

### HarnessToolContext fields

| Field | Type | Description |
|---|---|---|
| `sessionId` | `string` | Unique session ID for this agent loop run |
| `threadId` | `string` | Thread ID (from config or auto-generated) |
| `agentName` | `string` | Name of the agent executing the tool |
| `turn` | `number` | Current turn number in the loop |
| `signal` | `AbortSignal?` | Cooperative cancellation signal |
| `config` | `ONIConfig` | Runtime configuration (inherited from ToolContext) |
| `store` | `BaseStore \| null` | Data store (inherited from ToolContext) |
| `state` | `Record<string, unknown>` | Current state snapshot (inherited from ToolContext) |
| `emit` | `(event, data) => void` | Event emitter (inherited from ToolContext) |

---

## 27. TodoModule

The `TodoModule` provides structured working memory for agents running long sessions. Without explicit state tracking, agents lose coherence after 20–30 turns as earlier context falls out of the effective attention window. The TodoModule solves this by injecting a `<todos>` reminder into the conversation after every tool call, keeping the agent aware of what it has done and what remains.

The module exposes two tools to the agent: `TodoWrite` (replace the full TODO list) and `TodoRead` (read current state). The agent uses these tools naturally during its work, and the harness handles reminder injection automatically.

```ts
import { TodoModule } from "@oni.bot/core";

const todo = new TodoModule("session_123");

// Programmatically write todos (or let the agent call TodoWrite)
todo.write([
  { id: "1", content: "Analyze codebase structure", status: "completed", priority: "high", updatedAt: 0 },
  { id: "2", content: "Refactor auth module", status: "in_progress", priority: "critical", updatedAt: 0 },
  { id: "3", content: "Write unit tests", status: "pending", priority: "high", updatedAt: 0 },
  { id: "4", content: "Update documentation", status: "pending", priority: "medium", updatedAt: 0 },
]);

// Query state
console.log(todo.getCurrentFocus());
// → { id: "2", content: "Refactor auth module", status: "in_progress", ... }

console.log(todo.getActive());
// → [todo #2, #3, #4] — everything not completed

console.log(todo.isComplete());
// → false

// Update a single todo's status
todo.updateStatus("2", "completed");

// Render as context string (injected into conversation automatically)
console.log(todo.toContextString());
// <todos>
//   ✓ Analyze codebase structure (completed)
//   ✓ Refactor auth module (completed)
//   ○ Write unit tests [high] (pending)
//   ○ Update documentation (pending)
// </todos>
```

### Using TodoModule with ONIHarness

When you use `ONIHarness`, the TodoModule is created automatically. The harness adds `TodoWrite` and `TodoRead` to every agent's tool set and injects reminders after each tool-use turn.

```ts
import { ONIHarness } from "@oni.bot/core";
import { anthropic } from "@oni.bot/core/models";

const harness = ONIHarness.create({
  model: anthropic("claude-sonnet-4-20250514"),
  maxTurns: 50,  // long session — TodoModule keeps the agent on track
});

// The agent will naturally use TodoWrite to plan its work
const result = await harness.runToResult(
  "Refactor the authentication system: analyze current code, update the login flow, add MFA support, and write tests.",
  { name: "refactorer", soul: "You are a meticulous software engineer. Always maintain a TODO list." },
);

// Access the module directly for inspection
const todos = harness.getTodoModule().getState();
console.log(`Completed ${todos.todos.filter(t => t.status === "completed").length} of ${todos.todos.length} tasks`);
```

### Serialization

TodoModule supports JSON serialization for persistence across sessions:

```ts
// Save state
const snapshot = todo.toJSON();
await fs.writeFile("todos.json", JSON.stringify(snapshot));

// Restore state
const loaded = JSON.parse(await fs.readFile("todos.json", "utf-8"));
const restored = TodoModule.fromJSON(loaded);
```

### Key API

- **`write(todos)`** — replace the full TODO list
- **`read()`** / **`getState()`** — get current `TodoState`
- **`updateStatus(id, status)`** — update a single todo
- **`getActive()`** — all non-completed todos
- **`getCurrentFocus()`** — the first `in_progress` todo
- **`isComplete()`** — true when all todos are completed
- **`getTools()`** — returns `[TodoWrite, TodoRead]` tool definitions
- **`toContextString()`** — render as `<todos>` XML for context injection
- **`onChange(callback)`** — subscribe to state changes (returns unsubscribe function)
- **`toJSON()`** / **`TodoModule.fromJSON(json)`** — serialization

---

## 28. HooksEngine

The `HooksEngine` provides 12 lifecycle events that fire at key points during the agent loop. Hooks enable logging, security enforcement, quality gates, and custom behaviors without modifying the core loop logic. Each hook receives a typed payload and can return a `HookResult` that allows, denies, or blocks the operation — with optional context injection and input modification.

Hooks are composable: `HooksEngine.compose()` merges multiple engines, `withSecurityGuardrails()` provides default protection against dangerous operations, and `withQualityGate()` validates responses before the agent stops.

```ts
import { HooksEngine } from "@oni.bot/core";
import type { HooksConfig } from "@oni.bot/core";

// Define hooks as config
const hooks: HooksConfig = {
  SessionStart: [{
    handler: async (payload) => {
      console.log(`Session ${payload.sessionId} started for ${payload.agentName}`);
      return {
        decision: "allow",
        additionalContext: "Remember: always follow the coding standards.",
      };
    },
  }],

  PreToolUse: [
    {
      // Only fires for Write and Edit tools (pipe OR pattern)
      matcher: "Write|Edit",
      handler: async (payload) => {
        console.log(`File write: ${JSON.stringify(payload.input)}`);
        return { decision: "allow" };
      },
    },
    {
      // Arg pattern: fires for Bash calls starting with "git"
      matcher: "Bash(git:*)",
      handler: async (payload) => {
        console.log(`Git command: ${payload.input.command}`);
        return { decision: "allow" };
      },
    },
  ],

  PostToolUse: [{
    handler: async (payload) => {
      if (payload.durationMs > 10_000) {
        console.warn(`Slow tool: ${payload.toolName} took ${payload.durationMs}ms`);
      }
      return { decision: "allow" };
    },
  }],

  Stop: [{
    description: "Ensure responses are at least 100 characters",
    handler: async (payload) => {
      const response = payload.response as string;
      if (response.length < 100) {
        return {
          decision: "block",
          reason: "Response too short. Please provide a more detailed answer.",
        };
      }
      return { decision: "allow" };
    },
  }],
};

const engine = new HooksEngine();
engine.configure(hooks);
```

### The 12 lifecycle events

| Event | When it fires | Payload fields |
|---|---|---|
| `SessionStart` | Agent loop begins | `agentName`, `tools` |
| `SessionEnd` | Agent loop completes | `reason`, `turns` |
| `UserPromptSubmit` | User prompt received | `prompt` |
| `PreToolUse` | Before tool execution | `toolName`, `input` |
| `PermissionRequest` | Tool requests elevated access | `toolName`, `input` |
| `PostToolUse` | After successful tool execution | `toolName`, `input`, `output`, `durationMs` |
| `PostToolUseFailure` | After tool execution fails | `toolName`, `input`, `error` |
| `SubagentStart` | Sub-agent spawned | `agentName`, `parentSessionId` |
| `SubagentStop` | Sub-agent completed | `agentName`, `parentSessionId` |
| `Stop` | Model returns without tool calls | `response` |
| `Notification` | Informational event | (custom fields) |
| `PreCompact` | Before context compaction | `messageCount`, `estimatedTokens` |

### Matcher patterns

Matchers filter `PreToolUse` and related hooks by tool name:

- **Exact match**: `"Write"` — matches only the `Write` tool
- **Pipe OR**: `"Write|Edit|MultiEdit"` — matches any of the listed tools
- **Wildcard**: `"*"` — matches all tools
- **Arg pattern**: `"Bash(git:*)"` — matches `Bash` calls where any input value starts with `"git"`

### HookResult decisions

| Decision | Effect |
|---|---|
| `"allow"` | Operation proceeds normally. `additionalContext` is aggregated. |
| `"deny"` | Tool call is blocked. Error message returned to model. |
| `"block"` | On `Stop` events: prevents the agent from stopping, injects `reason` as feedback. |
| `"escalate"` | Operation proceeds but is flagged for review. |

### Composing engines

```ts
import { HooksEngine } from "@oni.bot/core";

// Built-in security guardrails (blocks rm -rf, curl|sh, .env access, etc.)
const security = HooksEngine.withSecurityGuardrails();

// Quality gate — ensures responses meet a minimum standard
const quality = HooksEngine.withQualityGate((response) => {
  if (!response.includes("```")) {
    return "Please include code examples in your response.";
  }
  return null; // pass
});

// Your custom hooks
const custom = new HooksEngine();
custom.configure(hooks);

// Compose all three — hooks fire in order
const composed = HooksEngine.compose(security, quality, custom);
```

### Observability with onAny

```ts
engine.onAny((event, payload) => {
  // Log every event to your observability platform
  logger.info({ event, sessionId: payload.sessionId, ...payload });
});
```

---

## 29. ContextCompactor

The `ContextCompactor` monitors estimated token usage and automatically compacts conversation history before context quality degrades. Research shows LLM performance drops non-linearly above ~65% context utilization, so the compactor defaults to triggering at 68%. It uses a two-stage strategy: first stripping old tool results (less lossy), then performing full summarization via the fast model if still over threshold.

The compactor is designed to be driven by a cheap, fast model — pass `fastModel` in `HarnessConfig` and the harness routes it automatically. This keeps compaction costs low while preserving context quality.

```ts
import { ContextCompactor } from "@oni.bot/core";
import { anthropic } from "@oni.bot/core/models";

const compactor = new ContextCompactor({
  summaryModel: anthropic("claude-haiku-4-5-20251001"),
  threshold: 0.68,         // trigger at 68% usage (default)
  maxTokens: 200_000,      // context window size (default)
  charsPerToken: 4,        // estimation ratio (default)
  compactInstructions: "Preserve all file paths, function names, and error messages verbatim.",
});

// Check usage
const messages = [
  { role: "user" as const, content: "Analyze the codebase..." },
  { role: "assistant" as const, content: "I'll start by reading..." },
  // ... many more messages from a long session
];

console.log(compactor.estimateTokens(messages));   // e.g., 145000
console.log(compactor.usageFraction(messages));     // e.g., 0.725
console.log(compactor.shouldCompact(messages));     // true

// Compact the conversation
const compacted = await compactor.compact(messages);
// Returns either cleaned messages (stage 1) or [summary, "Context loaded."] (stage 2)
```

### Two-stage compaction strategy

| Stage | Action | Loss |
|---|---|---|
| **Stage 1** | Strip `tool`-role messages from older conversation, keeping the 10 most recent messages intact | Low — only tool outputs are removed |
| **Stage 2** | Summarize the entire conversation via the fast model, wrapped in `<summary>` tags | Higher — but the summary preserves key decisions, file paths, and task progress |

If the summary model fails (network error, timeout), the compactor falls back to a minimal truncation notice so the agent can continue.

### Using with ONIHarness

The harness wires the compactor automatically. Just configure the thresholds:

```ts
import { ONIHarness } from "@oni.bot/core";
import { anthropic } from "@oni.bot/core/models";

const harness = ONIHarness.create({
  model: anthropic("claude-sonnet-4-20250514"),
  fastModel: anthropic("claude-haiku-4-5-20251001"),  // used for compaction
  compaction: {
    threshold: 0.60,       // compact earlier for safety
    maxTokens: 200_000,
    charsPerToken: 4,
    compactInstructions: "Keep all TODO items and their statuses.",
  },
  maxTurns: 100,  // long session that will need compaction
});
```

### Key API

- **`estimateTokens(messages)`** — returns estimated token count (chars / charsPerToken)
- **`shouldCompact(messages)`** — true when usage exceeds threshold
- **`usageFraction(messages)`** — current usage as a fraction (0 to 1+)
- **`compact(messages)`** — performs two-stage compaction, returns compacted messages

### Tips

- Set `charsPerToken` to 3 for languages with longer tokens (e.g., code-heavy sessions) or 5 for natural language conversations.
- Use `compactInstructions` to tell the summarizer what to preserve — file paths, variable names, error messages, or TODO state are commonly important.
- The `PreCompact` hook fires before compaction, giving you a chance to log or adjust behavior.

---

## 30. SafetyGate

The `SafetyGate` adds a fast-model pre-execution check for potentially destructive tool calls. By default, it protects `Bash`, `Write`, and `MultiEdit` — the tools most likely to cause irreversible damage. Before any protected tool runs, the gate sends the tool name and arguments to a fast model that evaluates the risk and returns an approve/deny decision.

The gate uses a timeout (default 5 seconds) to ensure it never blocks the agent loop indefinitely. If the safety model times out or errors, the gate defaults to **approved** — a deliberate design choice to prevent false-negative deadlocks in production.

```ts
import { SafetyGate } from "@oni.bot/core";
import { anthropic } from "@oni.bot/core/models";

const gate = new SafetyGate({
  safetyModel: anthropic("claude-haiku-4-5-20251001"),
  protectedTools: ["Bash", "Write", "MultiEdit", "Deploy"],
  timeout: 3000,  // 3-second timeout
  safetySystemPrompt: `You are a safety evaluator. Respond with JSON:
{"approved": boolean, "reason": string, "riskScore": number}

Block: rm -rf, DROP TABLE, curl|sh, credential access.
Allow: reads, targeted writes, git operations, tests.`,
});

// Check if a tool requires gating
console.log(gate.requiresCheck("Bash"));   // true
console.log(gate.requiresCheck("Search")); // false

// Run a safety check
const result = await gate.check({
  id: "call_1",
  name: "Bash",
  args: { command: "rm -rf /tmp/build" },
});

console.log(result);
// { approved: false, reason: "Recursive force delete is dangerous", riskScore: 0.9 }
```

### Using with ONIHarness

```ts
import { ONIHarness } from "@oni.bot/core";
import { anthropic } from "@oni.bot/core/models";

const harness = ONIHarness.create({
  model: anthropic("claude-sonnet-4-20250514"),
  fastModel: anthropic("claude-haiku-4-5-20251001"),  // used for safety checks
  safety: {
    protectedTools: ["Bash", "Write", "MultiEdit"],
    timeout: 5000,
    // Optional: override the default safety prompt
    safetySystemPrompt: "Evaluate tool safety. Respond with JSON: {approved, reason, riskScore}",
  },
});
```

### SafetyCheckResult

| Field | Type | Description |
|---|---|---|
| `approved` | `boolean` | Whether the tool call is safe to execute |
| `reason` | `string?` | Explanation of the decision |
| `riskScore` | `number?` | 0–1 risk assessment |
| `suggestion` | `string?` | Safer alternative if denied |

### Key API

- **`requiresCheck(toolName)`** — returns `true` if the tool is in the protected set
- **`check(call)`** — sends the call to the safety model, returns `SafetyCheckResult`

### Tips

- Use a fast, cheap model for safety checks to minimize latency and cost.
- The default protected set (`Bash`, `Write`, `MultiEdit`) covers the most common destructive operations. Add domain-specific tools (e.g., `Deploy`, `DatabaseMigrate`) as needed.
- The timeout-defaults-to-approved design means you should pair the SafetyGate with the `HooksEngine.withSecurityGuardrails()` for defense-in-depth — the guardrails use pattern matching (no model call, no timeout risk) while the gate uses model judgment.

---

## 31. SkillLoader

The `SkillLoader` discovers and manages `SKILL.md` files — markdown documents with YAML frontmatter that contain specialized instructions for the agent. Skills are loaded from disk at startup, registered programmatically at runtime, and injected into the conversation on-demand when the agent invokes the `Skill` tool. This enables modular, domain-specific capabilities without bloating the system prompt.

Each skill file follows a simple frontmatter format. The loader scans directories recursively for files named `SKILL.md`, parses the frontmatter for metadata, and makes the skill available through a generated `Skill` tool.

### SKILL.md format

```markdown
---
name: code-review
description: Perform a thorough code review with security and performance checks
tools: Read, Grep, Glob
model: claude-sonnet-4-20250514
---

When performing a code review, follow these steps:

1. Read the file(s) to review using the Read tool
2. Check for security issues (SQL injection, XSS, credential exposure)
3. Check for performance issues (N+1 queries, missing indexes, unbounded loops)
4. Verify error handling and edge cases
5. Provide a structured review with severity ratings
```

### Loading skills

```ts
import { SkillLoader } from "@oni.bot/core";

// Load from directories (scans recursively for SKILL.md files)
const loader = SkillLoader.fromDirectories(["./skills", "./plugins"]);

// Or register programmatically
loader.register({
  name: "deploy",
  description: "Deploy the application to production",
  content: "Follow the deployment checklist:\n1. Run tests\n2. Build\n3. Deploy",
  sourcePath: "inline",
  tools: ["Bash"],
});

// List all registered skills
for (const skill of loader.getAll()) {
  console.log(`${skill.name}: ${skill.description}`);
}
```

### How skill injection works

When the agent calls the `Skill` tool with a skill name, the SkillLoader queues the skill's content for injection. On the next loop iteration, the agent loop detects the pending injection, inserts it as a user message wrapped in `<skill-instructions>` tags, and clears the queue. This gives the agent detailed instructions without permanently expanding the system prompt.

```ts
import { ONIHarness } from "@oni.bot/core";
import { anthropic } from "@oni.bot/core/models";

const harness = ONIHarness.create({
  model: anthropic("claude-sonnet-4-20250514"),
  skillPaths: ["./skills"],
  soul: "You are a coding assistant. Use skills when they match the user's request.",
});

// The system prompt will include:
// <available-skills>
//   <skill name="code-review">Perform a thorough code review...</skill>
//   <skill name="deploy">Deploy the application to production</skill>
// </available-skills>

// When the user says "review my PR", the agent calls:
//   Skill({ name: "code-review" })
// The skill instructions are injected into the next turn.

const result = await harness.runToResult("Review the changes in src/auth.ts", "reviewer");
```

### Runtime registration

Register skills after harness creation for dynamic capability loading:

```ts
harness.registerSkill({
  name: "database-migration",
  description: "Run database migrations safely",
  content: `Migration procedure:
1. Backup the current database
2. Run pending migrations with --dry-run first
3. Apply migrations
4. Verify schema integrity`,
  sourcePath: "runtime",
});
```

### Key API

- **`SkillLoader.fromDirectories(dirs)`** — scan directories for SKILL.md files
- **`SkillLoader.fromDirectory(dir)`** — scan a single directory
- **`register(skill)`** — register a skill programmatically
- **`getAll()`** — list all registered skills
- **`get(name)`** — get a single skill by name
- **`getDescriptionsForContext()`** — returns `<available-skills>` XML for the system prompt
- **`getSkillTool()`** — returns the `Skill` tool definition (auto-added by ONIHarness)
- **`invoke(name)`** — queue a skill for injection (returns `true` if found)
- **`getPendingInjection()`** — get queued content (used by the agent loop)
- **`clearPendingInjection()`** — clear the queue after injection

### Frontmatter fields

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Unique skill identifier |
| `description` | No | Short description shown to the agent |
| `tools` | No | Comma-separated list of tools the skill uses |
| `model` | No | Suggested model for this skill |

---

## 32. Production Patterns

This section covers patterns for deploying harness-powered agents in production: multi-model routing, error recovery, observability, and deployment considerations.

### Multi-model routing

Use a powerful model for complex reasoning and a fast model for safety checks and compaction. This balances quality against cost and latency.

```ts
import { ONIHarness } from "@oni.bot/core";
import { anthropic } from "@oni.bot/core/models";

const harness = ONIHarness.create({
  // Primary model: handles all agent reasoning and tool-use decisions
  model: anthropic("claude-sonnet-4-20250514"),

  // Fast model: used by SafetyGate and ContextCompactor
  // ~10x cheaper, 3x faster — ideal for yes/no safety checks and summarization
  fastModel: anthropic("claude-haiku-4-5-20251001"),

  soul: "You are a production coding assistant.",
  maxTurns: 50,
  compaction: { threshold: 0.65 },
  safety: { protectedTools: ["Bash", "Write", "MultiEdit"] },
});
```

### Error recovery with hooks

Use hooks to detect, log, and recover from errors without crashing the agent loop:

```ts
import { ONIHarness } from "@oni.bot/core";
import { anthropic } from "@oni.bot/core/models";
import type { HooksConfig } from "@oni.bot/core";

const hooks: HooksConfig = {
  PostToolUseFailure: [{
    handler: async (payload) => {
      // Log failures to your monitoring system
      console.error(`[TOOL_FAILURE] ${payload.toolName}`, {
        sessionId: payload.sessionId,
        input: payload.input,
        error: payload.error,
      });

      // Return context to help the agent recover
      return {
        decision: "allow",
        additionalContext: `The ${payload.toolName} tool failed. Try an alternative approach.`,
      };
    },
  }],

  SessionEnd: [{
    handler: async (payload) => {
      // Track session metrics
      console.log(`Session completed in ${payload.turns} turns (reason: ${payload.reason})`);
      return { decision: "allow" };
    },
  }],
};

const harness = ONIHarness.create({
  model: anthropic("claude-sonnet-4-20250514"),
  fastModel: anthropic("claude-haiku-4-5-20251001"),
  hooks,
});
```

### Observability with onAny

Capture every lifecycle event for structured logging, metrics, and tracing:

```ts
const harness = ONIHarness.create({
  model: anthropic("claude-sonnet-4-20250514"),
  fastModel: anthropic("claude-haiku-4-5-20251001"),
});

// Attach a global event listener for observability
harness.getHooksEngine().onAny((event, payload) => {
  const record = {
    timestamp: Date.now(),
    event,
    sessionId: payload.sessionId,
    agentName: (payload as any).agentName,
    toolName: (payload as any).toolName,
    durationMs: (payload as any).durationMs,
  };

  // Send to your logging/metrics pipeline
  // logger.info(record);
  // metrics.increment(`oni.harness.${event}`);
  console.log(JSON.stringify(record));
});
```

### Cooperative cancellation

Use `AbortSignal` for graceful shutdown in server environments:

```ts
import { agentLoop } from "@oni.bot/core";
import { anthropic } from "@oni.bot/core/models";

const controller = new AbortController();

// Set a hard timeout for the entire session
setTimeout(() => controller.abort(), 300_000); // 5 minutes

// Or abort on external signal (e.g., HTTP request cancelled)
process.on("SIGINT", () => controller.abort());

for await (const msg of agentLoop("Process this request", {
  model: anthropic("claude-sonnet-4-20250514"),
  tools: [],
  agentName: "worker",
  systemPrompt: "You are a worker agent.",
  maxTurns: 50,
  signal: controller.signal,
})) {
  if (msg.type === "error" && msg.content?.includes("aborted")) {
    console.log("Session cancelled gracefully");
    break;
  }
}
```

### Defense-in-depth safety

Layer multiple safety mechanisms for production deployments:

```ts
import { ONIHarness, HooksEngine } from "@oni.bot/core";
import { anthropic } from "@oni.bot/core/models";

const harness = ONIHarness.create({
  model: anthropic("claude-sonnet-4-20250514"),
  fastModel: anthropic("claude-haiku-4-5-20251001"),

  // Layer 1: SafetyGate — model-based judgment for protected tools
  safety: {
    protectedTools: ["Bash", "Write", "MultiEdit"],
    timeout: 5000,
  },

  // Layer 2: HooksEngine security guardrails — pattern-based blocking
  // (automatically composed by ONIHarness.create())
  // Blocks: rm -rf, curl|sh, .env access, credentials, etc.

  // Layer 3: Custom hooks for domain-specific rules
  hooks: {
    PreToolUse: [{
      matcher: "Bash",
      handler: async (payload) => {
        const cmd = (payload.input as any).command ?? "";
        // Block production database access
        if (cmd.includes("production") && cmd.includes("psql")) {
          return { decision: "deny", reason: "Production database access is not allowed." };
        }
        return { decision: "allow" };
      },
    }],
  },
});
```

### Bridging harness agents into swarm orchestration

Combine the harness layer (micro) with the swarm layer (macro) for complex multi-agent systems:

```ts
import { StateGraph, START, END, lastValue } from "@oni.bot/core";
import { ONIHarness } from "@oni.bot/core";
import { anthropic } from "@oni.bot/core/models";
import { defineTool } from "@oni.bot/core/tools";

const searchTool = defineTool({
  name: "Search",
  description: "Search the knowledge base",
  schema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
  execute: async (input) => `Results for: ${input.q}`,
});

const harness = ONIHarness.create({
  model: anthropic("claude-sonnet-4-20250514"),
  fastModel: anthropic("claude-haiku-4-5-20251001"),
  sharedTools: [searchTool],
  maxTurns: 20,
});

type PipelineState = {
  task: string;
  agentResults: Record<string, string>;
};

const pipeline = new StateGraph<PipelineState>({
  channels: {
    task: lastValue(() => ""),
    agentResults: lastValue(() => ({})),
  },
});

// Each node is a harness-powered agent with its own tools, soul, and turn budget
pipeline.addNode("research", harness.asNode({
  name: "researcher",
  soul: "You are a thorough researcher. Search for information and compile findings.",
  tools: [searchTool],
  maxTurns: 15,
}));

pipeline.addNode("analyze", harness.asNode({
  name: "analyst",
  soul: "You are a data analyst. Analyze research findings and identify key insights.",
  maxTurns: 10,
}));

pipeline.addNode("report", harness.asNode({
  name: "reporter",
  soul: "You are a technical writer. Produce a clear, concise report from the analysis.",
  maxTurns: 10,
}));

pipeline.addEdge(START, "research");
pipeline.addEdge("research", "analyze");
pipeline.addEdge("analyze", "report");
pipeline.addEdge("report", END);

const app = pipeline.compile();
const result = await app.invoke({ task: "Analyze the impact of LLMs on software development" });

// Each agent's output is in agentResults
console.log(result.agentResults.researcher);
console.log(result.agentResults.analyst);
console.log(result.agentResults.reporter);
```

### Deployment tips

- **Set `maxTurns` conservatively** — start with 20, increase only after monitoring real sessions. Runaway loops burn tokens.
- **Always provide a `fastModel`** — safety and compaction run on every turn; using the primary model for these is wasteful.
- **Use `compactInstructions`** — tell the summarizer what matters for your domain (file paths, error codes, TODO state).
- **Monitor with `onAny`** — pipe all events to structured logging from day one. You will need the data when debugging agent behavior.
- **Compose security hooks** — `ONIHarness.create()` automatically applies `withSecurityGuardrails()`. Add domain-specific rules via the `hooks` config.
- **Serialize TodoModule state** — for long-running or resumable sessions, persist `toJSON()` and restore with `fromJSON()`.
- **Test with `mockModel`** — use the testing utilities from Section 22 to write deterministic tests for harness-powered agents.
