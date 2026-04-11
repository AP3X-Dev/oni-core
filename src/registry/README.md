# @oni.bot/core/registry — DynamicToolRegistry

A hot-loadable extension point for `StateGraph`. The registry acts as a single
compiled node that internally dispatches to a mutable handler map. Extensions
can be added and removed at runtime without recompiling the graph.

## Usage

```typescript
import { StateGraph, START, END, appendList, lastValue } from "@oni.bot/core";
import { DynamicToolRegistry } from "@oni.bot/core/registry";
import type { DynamicToolState } from "@oni.bot/core/registry";

// 1. Create the registry
const registry = new DynamicToolRegistry();

// 2. Register built-in tools at startup
registry.register("read_file", async (args) => ({
  tool_name: "read_file",
  success: true,
  output: `Contents of ${args.path}`,
}), {
  description: "Read a file from disk",
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
});

registry.register("write_file", async (args) => ({
  tool_name: "write_file",
  success: true,
  output: `Wrote ${args.path}`,
}), {
  description: "Write content to a file",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
});

// 3. Wire into a StateGraph
type State = DynamicToolState;

const graph = new StateGraph<State>({
  channels: {
    messages: appendList(() => []),
    pendingTools: lastValue(() => []),
  },
})
  .addNode("tool_executor", registry.asNode())
  .addConditionalEdges(START, (state) => {
    return state.pendingTools.length > 0 ? "tool_executor" : "__end__";
  }, { tool_executor: "tool_executor", [END]: END })
  .addEdge("tool_executor", END);

const app = graph.compile();

// 4. Register a new extension at runtime — no recompile
registry.register("search_web", async (args) => ({
  tool_name: "search_web",
  success: true,
  output: `Results for "${args.query}"`,
}), {
  description: "Search the web",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
});

// 5. Unregister — also live
registry.unregister("search_web");

// 6. Pass registered tool schemas to the LLM
const toolSchemas = registry.asSchema();
// toolSchemas is an array of { type: "function", function: { name, description, parameters } }
```

## API

### `new DynamicToolRegistry()`

Creates an empty registry.

### `.register(name, handler, opts?)`

Register a tool handler. Returns `this` for chaining. If a tool with the same
name is already registered, the handler is replaced (hot-swap).

- `name` — unique tool name
- `handler` — `(args, state) => Promise<ToolResult>`
- `opts.description` — tool description for schema generation
- `opts.parameters` — JSON Schema for the tool's arguments

### `.unregister(name)`

Remove a tool. Returns `true` if it existed.

### `.list()`

Returns an array of currently registered tool names.

### `.has(name)`

Returns `true` if the named tool is registered.

### `.asNode()`

Returns a `NodeFn<DynamicToolState>` suitable for `graph.addNode()`. The node:
- Reads `state.pendingTools[0]`
- Dispatches to the matching handler
- Returns the result as a tool message in `messages`
- Returns a structured error (never throws) if the tool is not found

### `.asSchema()`

Returns an array of tool definitions in OpenAI function-calling format, suitable
for passing to an LLM node as `tools`.
