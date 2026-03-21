# Branch Map — Cycle 258

**Generated:** 2026-03-22T01:50:00Z
**Main HEAD:** 26b75e2
**Total Branches:** 30 (was 33 at C257; 0 deleted, 0 net new this cycle)

| Branch | Status | Behind Main | Conflicts | Last Commit | Notes |
|---|---|---|---|---|---|
| bugfix/BUG-0295 | fixed | 77 | 0 | 2026-03-21 | `src/errors.ts` — toJSON stack leak |
| bugfix/BUG-0355 | fixed | 807 | 1 | 2026-03-20 | `packages/stores/src/redis/index.ts` — CONFLICT; recreate from main |
| bugfix/BUG-0356 | fixed | 807 | 2 | 2026-03-20 | `packages/stores/src/postgres/index.ts` — CONFLICT; recreate from main |
| bugfix/BUG-0357 | fixed | 1 | 0 | 2026-03-21 | `src/models/ollama.ts` + 3 extra files — WARNING: branch contains extra commits (BUG-0454/455/456 content), prior rebase artifact; needs fixer review |
| bugfix/BUG-0358 | fixed | 807 | 0 | 2026-03-21 | `src/harness/hooks-engine.ts` |
| bugfix/BUG-0359 | fixed | 61 | 0 | 2026-03-21 | `src/harness/loop/index.ts` |
| bugfix/BUG-0366 | fixed | 61 | 0 | 2026-03-21 | `src/harness/memory/index.ts` |
| bugfix/BUG-0376 | fixed | 140 | 0 | 2026-03-20 | `src/models/openai.ts` |
| bugfix/BUG-0377 | fixed | 807 | 0 | 2026-03-20 | `src/models/ollama.ts` — overlaps BUG-0357 |
| bugfix/BUG-0378 | fixed | 807 | 1 | 2026-03-20 | `src/swarm/pool.ts` — CONFLICT; recreate from main |
| bugfix/BUG-0379 | fixed | 807 | 0 | 2026-03-20 | `src/swarm/agent-node.ts` — overlaps BUG-0410 |
| bugfix/BUG-0383 | fixed | 139 | 0 | 2026-03-20 | `src/swarm/snapshot.ts` |
| bugfix/BUG-0388 | fixed | 140 | 0 | 2026-03-20 | `src/stream-events.ts` |
| bugfix/BUG-0389 | fixed | 807 | 0 | 2026-03-20 | `src/testing/index.ts` |
| bugfix/BUG-0390 | fixed | 807 | 0 | 2026-03-20 | `src/checkpointers/namespaced.ts` + test |
| bugfix/BUG-0400 | fixed | 807 | 0 | 2026-03-20 | `packages/tools/src/browser/firecrawl.ts` |
| bugfix/BUG-0404 | fixed | 807 | 0 | 2026-03-21 | `src/agents/define-agent.ts` — overlaps BUG-0443 (merged) |
| bugfix/BUG-0409 | fixed | 36 | 0 | 2026-03-21 | `src/dlq.ts` + test — DLQ ID collision |
| bugfix/BUG-0410 | fixed | 108 | 0 | 2026-03-20 | `src/swarm/agent-node.ts` — overlaps BUG-0379 |
| bugfix/BUG-0413 | no-entry | 807 | 1 | 2026-03-21 | `src/internal/validate-command.ts` — CONFLICT; no tracker entry |
| bugfix/BUG-0415 | fixed | 106 | 0 | 2026-03-20 | `src/store/index.ts` — overlaps BUG-0421 |
| bugfix/BUG-0418 | fixed | 106 | 0 | 2026-03-20 | `src/cli/build.ts` |
| bugfix/BUG-0420 | fixed | 0 | 0 | 2026-03-21 | `src/coordination/pubsub.ts` — **REBASED C258, MERGE READY PRIORITY #1** |
| bugfix/BUG-0421 | fixed | 807 | 0 | 2026-03-20 | `src/store/index.ts` — overlaps BUG-0415 |
| bugfix/BUG-0435 | fixed | 807 | 0 | 2026-03-21 | `src/swarm/scaling.ts` |
| bugfix/BUG-0450 | reopened | 807 | 0 | 2026-03-21 | `packages/loaders/src/loaders/json.ts` |
| bugfix/BUG-0452 | pending | 807 | 0 | 2026-03-21 | `src/pregel/checkpointing.ts` — overlaps BUG-0453 HIGH |
| bugfix/BUG-0453 | fixed | 807 | 1 | 2026-03-21 | `src/pregel/checkpointing.ts` — CONFLICT; overlaps BUG-0452 HIGH |
| bugfix/BUG-0457 | fixed | 807 | 0 | 2026-03-15 | `src/checkpointers/redis.ts` — very stale |
| bugfix/BUG-0458 | fixed | 807 | 0 | 2026-03-21 | `src/events/bridge.ts` |

## File Overlap Summary (Cycle 258)

| Files | Branches | Risk |
|---|---|---|
| `src/pregel/checkpointing.ts` | BUG-0452 + BUG-0453 | HIGH — BUG-0453 has conflict; resolve order critical |
| `src/models/ollama.ts` | BUG-0357 + BUG-0377 | MEDIUM — BUG-0357 has extra content, validate carefully |
| `src/swarm/agent-node.ts` | BUG-0379 + BUG-0410 | MEDIUM |
| `src/store/index.ts` | BUG-0415 + BUG-0421 | LOW |
| `src/agents/define-agent.ts` | BUG-0404 + BUG-0443 (merged) | LOW — BUG-0443 already on main |

## Conflict Branches (5)
- BUG-0355: 1 conflict (redis/index.ts) — needs recreate
- BUG-0356: 2 conflicts (postgres/index.ts) — needs recreate
- BUG-0378: 1 conflict (pool.ts) — needs recreate
- BUG-0413: 1 conflict (validate-command.ts) + NO TRACKER ENTRY — needs investigation
- BUG-0453: 1 conflict (checkpointing.ts) — HIGH overlap with BUG-0452
