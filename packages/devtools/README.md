# @oni.bot/devtools

Lightweight dev server for inspecting an [@oni.bot/core](https://www.npmjs.com/package/@oni.bot/core)
graph while it runs.

Shows the graph topology, the current `DynamicToolRegistry` state, a live
log of node execution events, and per-run timing. Dev-only — not for
production.

## Install

```bash
npm install @oni.bot/devtools
```

## Usage

```typescript
import { StateGraph } from "@oni.bot/core";
import { DynamicToolRegistry } from "@oni.bot/core/registry";
import { startDevtools } from "@oni.bot/devtools";

const registry = new DynamicToolRegistry();
const graph = new StateGraph({ channels: { /* ... */ } });
// ... build your graph ...
const app = graph.compile();

const devtools = await startDevtools({
  graph,
  registry,
  port: 7823,
});

console.log(`Devtools running at ${devtools.url}`);

// Instrument your graph to emit events
// (call devtools.emit() from your node wrappers)

// ... later ...
await devtools.stop();
```

## Endpoints

| Path | Returns |
|------|---------|
| `GET /` | HTML UI with live panels |
| `GET /graph` | Topology JSON (nodes + edges) |
| `GET /registry` | Current registered tools + schemas |
| `GET /runs` | Last N runs with events and timing |
| `GET /stream` | SSE stream of node and tool lifecycle events |

## SSE event types

- `node_start` — `{ run_id, node, ts }`
- `node_end` — `{ run_id, node, ts, duration_ms, state_keys_changed }`
- `tool_registered` — `{ name, source? }`
- `tool_unregistered` — `{ name }`

## API

### `startDevtools(options): Promise<DevtoolsServer>`

**Options:**
- `graph` — compiled graph that exposes `getGraph()` (topology)
- `registry` — tool registry that exposes `list()` and `asSchema()`
- `port?` — default `7823`
- `maxRuns?` — in-memory run history limit, default `50`

**Returns:**
- `url` — `http://localhost:<port>`
- `stop()` — shut down the server
- `emit(event)` — record a node lifecycle event
- `emitToolRegistered(name, source?)`
- `emitToolUnregistered(name)`

## License

MIT
