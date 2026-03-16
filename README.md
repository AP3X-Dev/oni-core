<p align="center">
  <strong>@oni.bot/core</strong>
</p>

<h3 align="center">The graph execution engine for production agent swarms.</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/@oni.bot/core"><img src="https://img.shields.io/npm/v/@oni.bot/core.svg" alt="npm version" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen" alt="zero dependencies" />
</p>

---

## Install

```bash
npm install @oni.bot/core
```

- **Zero runtime dependencies.** Self-contained TypeScript. No transitive supply-chain risk. Runs in Node.js 18+, serverless functions, and edge runtimes without adaptation.
- **5 model adapters via raw HTTP.** Anthropic, OpenAI, OpenRouter, Google, and Ollama — no vendor SDKs required.
- **21 exports.** Root package plus 20 named subpaths for precise tree shaking.

---

## Quick Start

```ts
import { StateGraph, START, END, lastValue, anthropic } from "@oni.bot/core";

type State = {
  question: string;
  answer: string;
};

const model = anthropic("claude-sonnet-4-6");

const graph = new StateGraph<State>({
  channels: {
    question: lastValue<string>(() => ""),
    answer:   lastValue<string>(() => ""),
  },
});

graph.addNode("answer", async (state) => {
  const response = await model.chat({
    messages: [{ role: "user", content: state.question }],
  });
  return { answer: response.content as string };
});

graph.addEdge(START, "answer");
graph.addEdge("answer", END);

const app = graph.compile();

for await (const chunk of app.stream(
  { question: "What is a Pregel execution model?" },
  { streamMode: "values" },
)) {
  console.log(chunk.answer);
}
```

---

## Sub-modules

21 entry points — import only what you use.

| Subpath | Description |
|---|---|
| `@oni.bot/core` | Core engine: `StateGraph`, `START`, `END`, channels, `Command`, `Send` |
| `@oni.bot/core/prebuilt` | Prebuilt agents: `createReactAgent`, `defineAgent` |
| `@oni.bot/core/swarm` | Swarm templates: `SwarmGraph` (hierarchical, fan-out, pipeline, peer-network, map-reduce, debate, mesh) |
| `@oni.bot/core/hitl` | Human-in-the-loop: `interrupt`, `getUserInput`, `getUserApproval` |
| `@oni.bot/core/store` | Cross-thread KV store: `InMemoryStore`, `BaseStore`, `NamespacedStore` |
| `@oni.bot/core/messages` | Message channel primitives: `messagesChannel`, `MessageAnnotation` |
| `@oni.bot/core/checkpointers` | Persistence backends: `MemoryCheckpointer`, `SqliteCheckpointer` |
| `@oni.bot/core/functional` | Functional API: `task`, `entrypoint`, `pipe`, `branch` |
| `@oni.bot/core/inspect` | Graph inspection: `buildGraphDescriptor`, `toMermaid`, cycle detection |
| `@oni.bot/core/streaming` | Token streaming: `emitToken`, `getStreamWriter`, `StreamWriter` |
| `@oni.bot/core/models` | LLM adapters: `anthropic`, `openai`, `openrouter`, `google`, `ollama` |
| `@oni.bot/core/tools` | Tool definition: `defineTool`, `ToolSchema`, `ToolResult` |
| `@oni.bot/core/agents` | Agent builder: `defineAgent`, `AgentDefinition` |
| `@oni.bot/core/coordination` | Inter-agent messaging: `RequestReplyBroker`, `PubSub` |
| `@oni.bot/core/events` | Event bus: `EventBus`, 10 lifecycle event types |
| `@oni.bot/core/guardrails` | Budget and safety: `BudgetTracker`, `ContentFilter`, `PermissionGuard` |
| `@oni.bot/core/testing` | Test utilities: `mockModel`, `assertGraph`, `createTestHarness` |
| `@oni.bot/core/harness` | Agentic loop: `ONIHarness`, `AgentLoop`, `HooksEngine`, `ContextCompactor` |
| `@oni.bot/core/mcp` | MCP client: JSON-RPC/stdio tool bridge |
| `@oni.bot/core/lsp` | LSP client: language server protocol primitives |
| `@oni.bot/core/config` | Config loader: JSONC parsing, environment variable resolution |

---

## Documentation

- **[Developer Guide](./GUIDE.md)** — Progressive tutorial from zero to advanced: graphs, channels, streaming, checkpointing, agents, swarms, and more.

---

## Ecosystem

**Built on @oni.bot/core:**

- [`@oni.bot/code`](https://github.com/AP3X-Dev) — AI coding assistant CLI *(coming soon)*
- [`@oni.bot/sentinel`](https://github.com/AP3X-Dev) — Code analysis and review engine *(coming soon)*

---

## License

MIT — [AP3X Dev](https://github.com/AP3X-Dev)
