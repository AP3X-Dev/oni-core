# Contributing to ONI

Thank you for your interest in contributing to ONI! This guide will help you
get started with development, understand the project structure, and submit
high-quality pull requests.

## Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/AP3X-Dev/oni-core.git
   cd oni-core
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run the test suite**
   ```bash
   npm test
   ```

4. **Type check**
   ```bash
   npm run typecheck
   ```

5. **Build**
   ```bash
   npm run build
   ```

## Project Structure

```
src/
  graph.ts          — StateGraph builder, compiles to executable skeleton
  pregel.ts         — Pregel superstep execution engine
  types.ts          — Core types (Channel, Command, Send, StreamMode, etc.)
  context.ts        — AsyncLocalStorage runtime context
  streaming.ts      — Token streaming (emitToken, TokenStreamWriter)
  checkpoint.ts     — Checkpointer implementations
  store/            — BaseStore, InMemoryStore, NamespacedStore
  hitl/             — Human-in-the-loop (interrupt / getUserInput)
  agents/           — Prebuilt agent patterns (createReactAgent, etc.)
  models/           — Model adapters (OpenAI, Anthropic, OpenRouter)
  tools/            — Tool definitions and execution
  testing/          — Test utilities (mockModel, helpers)
  __tests__/        — Test files
```

## Making Changes

1. **Fork the repo** and create a feature branch from `main`.
2. **Write tests first** — we practice TDD. Add or update tests in `src/__tests__/`.
3. **Make your changes** in the relevant source files.
4. **Verify everything passes:**
   ```bash
   npm test
   npm run typecheck
   ```
5. **Submit a pull request** against `main` with a clear description of the change.

## Code Style

- **TypeScript strict mode** — no `any` unless absolutely necessary.
- **ESM only** — no CommonJS (`require`/`module.exports`). Use `import`/`export`.
- **Zero runtime dependencies** — do not add any. The core must remain dependency-free.
- **Every new feature needs tests** — untested code will not be merged.
- **Keep it simple** — follow YAGNI. Do not add abstractions until they are needed.

## Testing

- **Run all tests:** `npm test`
- **Watch mode:** `npm run test:watch`
- **Use `mockModel()`** from `@oni.bot/core/testing` to mock LLM responses in tests.
- Tests live alongside source code in `src/__tests__/`.

## Architecture Decisions

Understanding these principles will help you write code that fits the project:

- **Pregel superstep model** — nodes execute in parallel within each superstep.
- **Channel reducers** — state is managed through typed channels with reducer functions.
- **AsyncLocalStorage for runtime context** — `getConfig()`, `getStore()`, and
  `getStreamWriter()` are available inside any node without explicit parameter passing.
- **Zero-dep core** — external integrations belong in adapter modules, not the core.

## Reporting Issues

- Search existing issues before opening a new one.
- Include a minimal reproduction case whenever possible.
- Specify your Node.js version and OS.
- For bugs, include the exact error message and stack trace.

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR.
- Update or add tests for every change.
- Make sure CI passes (typecheck + tests on Node 18/20/22).
- Write a clear PR description explaining *why* the change is needed.

## License

MIT — all contributions are made under the same license.
