# Branch Map — Cycle 255

**Generated:** 2026-03-22T01:00:00Z
**Main HEAD:** d9839fc
**Total Branches:** 37 (was 41; 0 deleted, 0 net new this cycle)

| Branch | Status | Behind Main | Conflicts | Last Commit | Notes |
|---|---|---|---|---|---|
| bugfix/BUG-0295 | fixed | 50 | 0 | 2026-03-21 | `src/errors.ts` — stack in toJSON |
| bugfix/BUG-0355 | fixed (reopened) | 780 | 1 | 2026-03-20 | `packages/stores/src/redis/index.ts` — CONFLICT; recreate from main |
| bugfix/BUG-0356 | fixed (reopened) | 780 | 2 | 2026-03-20 | `packages/stores/src/postgres/index.ts` — CONFLICT; recreate from main |
| bugfix/BUG-0357 | fixed | 0 | 0 | 2026-03-21 | **REBASED C255** — `src/models/ollama.ts`; Validator-ready PRIORITY #1 |
| bugfix/BUG-0358 | fixed | 780 | 0 | 2026-03-20 | `src/harness/hooks-engine.ts` — chmod regex |
| bugfix/BUG-0359 | fixed (reopened) | 34 | 0 | 2026-03-21 | `src/harness/loop/index.ts` — off-by-one turns |
| bugfix/BUG-0366 | fixed (reopened) | 34 | 0 | 2026-03-21 | `src/harness/memory/index.ts` — hydrate() clone |
| bugfix/BUG-0376 | fixed | 113 | 0 | 2026-03-20 | `src/models/openai.ts` — embed JSON parse |
| bugfix/BUG-0377 | fixed | 780 | 0 | 2026-03-20 | `src/models/ollama.ts` — chat/embed JSON parse |
| bugfix/BUG-0378 | fixed | 780 | 1 | 2026-03-20 | `src/swarm/pool.ts` — CONFLICT; retry timer cancel |
| bugfix/BUG-0379 | fixed | 780 | 0 | 2026-03-20 | `src/swarm/agent-node.ts` — retry timer AbortSignal |
| bugfix/BUG-0383 | fixed | 112 | 0 | 2026-03-20 | `src/swarm/snapshot.ts` — cap >= check |
| bugfix/BUG-0388 | fixed | 113 | 0 | 2026-03-20 | `src/stream-events.ts` — finalData fallback |
| bugfix/BUG-0389 | fixed | 780 | 0 | 2026-03-20 | `src/testing/index.ts` — invocationCount dead code |
| bugfix/BUG-0390 | fixed | 780 | 0 | 2026-03-20 | `src/checkpointers/namespaced.ts` — key prefix order |
| bugfix/BUG-0394 | fixed (reopened) | 780 | 0 | 2026-03-21 | `src/swarm/tracer.ts` — clear() in-place mutation |
| bugfix/BUG-0400 | fixed | 780 | 0 | 2026-03-20 | `packages/tools/src/browser/firecrawl.ts` — SSRF validation |
| bugfix/BUG-0404 | fixed (reopened) | 780 | 0* | 2026-03-21 | **CRITICAL**: 780 behind, carries full-codebase divergence. Fixer must delete and recreate from main. |
| bugfix/BUG-0409 | fixed (reopened) | 9 | 0 | 2026-03-21 | `src/dlq.ts` — DLQ ID collision; Validator-ready PRIORITY #2 |
| bugfix/BUG-0410 | fixed | 81 | 0 | 2026-03-21 | `src/swarm/agent-node.ts` — handoffHistory accumulate |
| bugfix/BUG-0413 | fixed | 780 | 1 | 2026-03-21 | `src/internal/validate-command.ts` — CONFLICT; path traversal regex |
| bugfix/BUG-0415 | fixed | 79 | 0 | 2026-03-21 | `src/store/index.ts` — expired keys collect-then-delete |
| bugfix/BUG-0416 | fixed | 780 | 0 | 2026-03-21 | `src/streaming.ts` — TokenStreamWriter drain-before-done |
| bugfix/BUG-0417 | fixed | 780 | 0 | 2026-03-21 | `src/cli/dev.ts` — cwd containment check |
| bugfix/BUG-0418 | fixed | 79 | 0 | 2026-03-21 | `src/cli/build.ts` — null exit code signal kill |
| bugfix/BUG-0419 | fixed | 780 | 0 | 2026-03-21 | `packages/tools/src/stripe/index.ts` — Stripe try/catch |
| bugfix/BUG-0420 | fixed | 780 | 0 | 2026-03-21 | `src/coordination/pubsub.ts` — subscriber cap |
| bugfix/BUG-0421 | fixed | 780 | 0 | 2026-03-21 | `src/store/index.ts` — ttl:0 immediate expire |
| bugfix/BUG-0422 | fixed | 780 | 0 | 2026-03-21 | `packages/integrations/src/adapter/index.ts` — authResolver try/catch |
| bugfix/BUG-0428 | fixed | 780 | 0 | 2026-03-21 | `packages/tools/src/browser/firecrawl.ts` — includeMarkdown |
| bugfix/BUG-0430 | fixed | 32 | 0 | 2026-03-21 | `src/harness/loop/index.ts` — finalizeMemory try/catch |
| bugfix/BUG-0435 | fixed | 780 | 0 | 2026-03-21 | `src/swarm/scaling.ts` — currentAgentCount snapshot |
| bugfix/BUG-0443 | reopened | 0 | 0 | 2026-03-21 | `src/agents/define-agent.ts` — ON MAIN HEAD; Fixer-ready |
| bugfix/BUG-0447 | fixed | 780 | 0 | 2026-03-21 | `src/inspect.ts` — unmapped conditional edge skip |
| bugfix/BUG-0448 | fixed | 15 | 0 | 2026-03-21 | `src/cli/init.ts` — initProject try/catch |
| bugfix/BUG-0449 | fixed | 780 | 0 | 2026-03-21 | `src/cli/run.ts` — null exit code signal |
| bugfix/BUG-0450 | fixed | 780 | 0 | 2026-03-21 | `packages/loaders/src/loaders/json.ts` — readFile try/catch |

## Conflict Summary

| Branch | Conflicting File | Action Required |
|---|---|---|
| bugfix/BUG-0355 | `packages/stores/src/redis/index.ts` | Delete + recreate from main |
| bugfix/BUG-0356 | `packages/stores/src/postgres/index.ts` | Delete + recreate from main |
| bugfix/BUG-0378 | `src/swarm/pool.ts` | Delete + recreate from main |
| bugfix/BUG-0413 | `src/internal/validate-command.ts` | Delete + recreate from main |

## File Overlap Risk

| File | Branches | Risk |
|---|---|---|
| `src/agents/define-agent.ts` | BUG-0404 (780 behind), BUG-0443 (0 behind) | HIGH — BUG-0404 must be deleted/recreated; merge BUG-0443 first |
| `packages/stores/src/redis/index.ts` + `postgres/index.ts` | BUG-0355, BUG-0356 | HIGH — both conflicted, exact same store files |
| `src/swarm/agent-node.ts` | BUG-0379, BUG-0410 | LOW — different hunks |
| `src/store/index.ts` | BUG-0415, BUG-0421 | LOW — different hunks |
| `packages/tools/src/browser/firecrawl.ts` | BUG-0400, BUG-0428 | LOW — different hunks |
| `src/models/ollama.ts` | BUG-0357 (rebased, on main HEAD), BUG-0377 (780 behind) | MEDIUM — BUG-0377 may conflict after BUG-0357 merges |
