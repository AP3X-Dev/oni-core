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
- **23 entry points.** Root package plus 22 named subpaths for precise tree shaking.

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

23 entry points — import only what you use.

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
| `@oni.bot/core/registry` | Dynamic runtime tool registry |
| `@oni.bot/core/platform` | Background-agent control plane: task specs, triggers, sessions, environments, identity, capabilities, artifacts, review gates |

---

## Background Agent Platform

`@oni.bot/core/platform` provides the reusable infrastructure layer around coding agents. It turns a task plus a trigger into a governed session with queueing, environment provisioning, scoped identity, capability grants, audit events, artifacts, and review state.
`capability.granted` audit events include structured capability summaries so
operators can see which command, connector, network, repo, secret, and tool
grants were issued without recording secret values.

```ts
import {
  BackgroundAgentPlatform,
  CerebroExecutionEnvironmentProvider,
  JsonFileAgentSessionStore,
  JsonFileArtifactStore,
  LocalExecutionEnvironmentProvider,
  createPostgresPlatformStores,
  createSqlitePlatformStores,
  StaticAgentRouter,
} from "@oni.bot/core/platform";

const platform = new BackgroundAgentPlatform({
  router: new StaticAgentRouter({
    agentId: "codex-worker",
    runtime: "codex",
    provider: "codex",
    requiredTools: ["git", "pnpm"],
  }),
  runner: {
    async run() {
      return {
        summary: "Implemented the fix and ran tests.",
        artifacts: [{
          type: "patch",
          title: "Auth callback patch",
          content: "diff --git ...",
        }],
      };
    },
  },
  environmentProvider: new LocalExecutionEnvironmentProvider({
    workspaceRoot: ".oni/workspaces",
  }),
  sessionStore: new JsonFileAgentSessionStore(".oni/platform/sessions.json"),
  artifactStore: new JsonFileArtifactStore(".oni/platform/artifacts.json"),
});

const session = await platform.runTask({
  task: {
    title: "Fix auth callback",
    goal: "Repair the redirect regression and verify it.",
    successCriteria: ["Regression test passes"],
    review: { required: true, reviewers: ["lead"] },
  },
  trigger: { kind: "vcs", source: "github.pull_request" },
});
```

For durable local or single-node deployments, the platform ships both
dependency-free JSON-file stores and optional SQLite stores. Use
`createSqlitePlatformStores(".oni/platform/state.sqlite")` when a deployment
needs indexed session status queries and artifact metadata in one durable
database file; the SQLite adapter keeps `better-sqlite3` as an optional peer.
For service deployments, `createPostgresPlatformStores(connectionString)`
provides the same session and artifact contracts on Postgres with `pg` kept as
an optional peer.

Remote devbox providers can plug into the same platform lifecycle through
`HttpExecutionEnvironmentProvider`, or `CerebroExecutionEnvironmentProvider`
when the service exposes Cerebro-style `/api/environments` routes:

```ts
const environmentProvider = new CerebroExecutionEnvironmentProvider({
  baseUrl: process.env.CEREBRO_URL!,
  token: process.env.CEREBRO_TOKEN,
});
```

For CLI-backed workers, `createExternalAgentSessionRunner()` bridges a platform
session to a harness `ExternalAgentDriver`. It applies the task scope before the
driver starts: allowed/disallowed paths are passed as ownership, explicit env is
filtered through granted secrets, denied policy actions are audited, and output
artifacts redact granted secret values.

Codex and Claude Code convenience drivers fail closed for provider options that
can bypass runtime controls. Raw `extraArgs`, Codex's approval/sandbox bypass,
and Claude Code's permission bypass require an explicit `unsafe` override in
the driver options.

CLI-backed drivers also bound retained provider output by default. Configure
`maxEvents`, `maxOutputChars`, `maxStderrChars`, and
`maxEventContentChars` when a deployment needs tighter limits; timeout and
abort handling attempt to terminate the provider process tree on Windows.
When a request includes ownership paths, the driver validates `cwd` before
spawning and validates provider path flags such as Codex `addDirs` and Claude
Code `mcpConfig`/`worktree` against the same boundary.
Codex and Claude JSONL parsers normalize text, tool calls, diffs, errors, and
encrypted reasoning into provider-neutral external-agent events while keeping
malformed frames observable as text/artifact events.
Failed platform-run external-agent sessions always include a failed-run
diagnosis artifact. If the provider exposes resume metadata, ONI preserves a
sanitized summary so operators can retry without storing arbitrary provider
metadata values.

For reviewable GitHub output, `GitHubArtifactStore` implements the platform
artifact-store contract. It can publish `pull_request` artifacts as GitHub pull
requests, publish reports/test summaries/diagnostics as issue or PR comments,
return the published URI to the session artifact, and mirror the enriched record
to another store such as `JsonFileArtifactStore`.

Trigger adapters such as `createCliTrigger()`, `createScheduledTrigger()`,
`createGitHubWebhookTrigger()`, `createChatCommandTrigger()`, and
`createDependencyAlertTrigger()` normalize launch events into platform
`AgentTrigger` records. GitHub webhook ingestion can verify
`X-Hub-Signature-256` from the raw body before creating VCS/security triggers.
Tool callers that
run inside a platform session can wrap existing `ToolDefinition`s with
`wrapToolWithRuntimePolicy()` to enforce path, command, network, and tool
capability checks before tool code executes.
The `@oni.bot/tools` filesystem factory also accepts a structural
`runtimePolicy` option, so platform callers can route default read/write/list
operations through the same grant, tool-capability, and path-scope enforcement
without adding a package build-order dependency on core internals.

To verify the local platform path without a real coding CLI, run:

```bash
oni platform-smoke --dir .oni/platform-smoke
```

The smoke command provisions a local session workspace, runs an in-process
external-agent driver, and writes durable JSON session/artifact state under the
chosen directory.

For operations, `BackgroundAgentPlatform#getHealthSnapshot()` summarizes queue
depth, active sessions, status counts, failure/cancellation rates, duration,
cost, and per-session artifact/audit counts. `getAuditSummary()` summarizes
audit events by type and can filter by session id, event type, or timestamp.
Deployments can pass a structural `logger` and OpenTelemetry-compatible
`tracer` to `BackgroundAgentPlatform` to receive lifecycle logs and spans for
routing, environment provisioning, identity/capability issuance, runner
execution, artifact publication, review, and resource release.

Platform sessions can also run the native harness loop with
`createAgentLoopSessionRunner()`. The adapter converts a platform task into an
`agentLoop()` prompt, applies runtime policy wrappers to configured tools by
default, and returns a durable report or failed-run diagnosis artifact.
Compiled swarm skeletons can run through `createSwarmSessionRunner()`, using the
same platform lifecycle, audit, artifact, and telemetry flow.

Release verification includes `pnpm run coverage:quality`, which enforces
global and module-specific coverage floors for critical platform, MCP/LSP,
external-agent, prebuilt, tool, GitHub, and auth-resolver surfaces. It also
includes `pnpm run smoke:exports`, which imports every built root package
export subpath, and `pnpm run typecheck:exports`, which compiles a temporary
consumer-style TypeScript program against every public subpath declaration
before packaging.
It also runs `pnpm run pack:snapshot` to inspect root and publishable workspace
tarball contents for missing entrypoints, source/test leakage, local artifacts,
and secret-like files. See `PACKAGE_RELEASE_POLICY.md` for the source-map and
tarball-content policy.

---

## Workspace Packages

Extension packages in `packages/` — install separately as needed.

| Package | Description |
|---|---|
| `@oni.bot/tools` | Prebuilt `ToolDefinition`-conforming tools (filesystem, HTTP, search, etc.) |
| `@oni.bot/stores` | Persistent KV store backends (Redis, Postgres) |
| `@oni.bot/loaders` | Document loaders (Markdown, JSON, CSV, PDF, HTML, DOCX) |
| `@oni.bot/a2a` | A2A protocol client, server, and swarm integration |
| `@oni.bot/integrations` | ActivePieces-to-ONI adapter (612 community integrations) |
| `@oni.bot/community` | ActivePieces community integrations source (internal) |

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
