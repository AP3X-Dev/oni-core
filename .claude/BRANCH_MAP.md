# Branch Map — Cycle 257

**Generated:** 2026-03-22T01:35:00Z
**Main HEAD:** 5778897
**Total Branches:** 33 (was 34; 0 deleted, 0 net new this cycle)

| Branch | Status | Behind Main | Conflicts | Last Commit | Notes |
|---|---|---|---|---|---|
| bugfix/BUG-0295 | fixed | 74 | 0 | 2026-03-21 | `src/errors.ts` — toJSON stack leak |
| bugfix/BUG-0355 | fixed | 805 | 1 | 2026-03-20 | `packages/stores/src/redis/index.ts` — CONFLICT; recreate from main |
| bugfix/BUG-0356 | fixed | 805 | 2 | 2026-03-21 | `packages/stores/src/postgres/index.ts` — 2 CONFLICTS; recreate from main |
| bugfix/BUG-0357 | fixed | 0 | 0 | 2026-03-21 | `src/models/ollama.ts` — REBASED C257; MERGE READY; OVERLAP with BUG-0377 |
| bugfix/BUG-0358 | fixed | 805 | 0 | 2026-03-21 | `src/harness/hooks-engine.ts` — chmod regex narrow |
| bugfix/BUG-0359 | fixed | 58 | 0 | 2026-03-21 | `src/harness/loop/index.ts` |
| bugfix/BUG-0366 | fixed | 58 | 0 | 2026-03-21 | `src/harness/memory/index.ts` |
| bugfix/BUG-0376 | fixed | 137 | 0 | 2026-03-20 | `src/models/openai.ts` — JSON parse embed |
| bugfix/BUG-0377 | fixed | 805 | 0 | 2026-03-20 | `src/models/ollama.ts` — OVERLAP with BUG-0357 |
| bugfix/BUG-0378 | fixed | 805 | 1 | 2026-03-20 | `src/swarm/pool.ts` — CONFLICT; recreate from main |
| bugfix/BUG-0379 | fixed | 805 | 0 | 2026-03-20 | `src/swarm/agent-node.ts` — OVERLAP with BUG-0410 |
| bugfix/BUG-0383 | fixed | 136 | 0 | 2026-03-20 | `src/swarm/snapshot.ts` |
| bugfix/BUG-0388 | fixed | 137 | 0 | 2026-03-20 | `src/stream-events.ts` |
| bugfix/BUG-0389 | fixed | 805 | 0 | 2026-03-20 | `src/testing/index.ts` |
| bugfix/BUG-0390 | fixed | 805 | 0 | 2026-03-20 | `src/checkpointers/namespaced.ts` |
| bugfix/BUG-0400 | fixed | 805 | 0 | 2026-03-20 | `packages/tools/src/browser/firecrawl.ts` |
| bugfix/BUG-0404 | fixed | 805 | 0 | 2026-03-21 | `src/agents/define-agent.ts` — BUG-0443 merged; re-evaluate conflict risk |
| bugfix/BUG-0409 | fixed | 33 | 0 | 2026-03-21 | `src/dlq.ts` — DLQ ID collision |
| bugfix/BUG-0410 | fixed | 105 | 0 | 2026-03-20 | `src/swarm/agent-node.ts` — OVERLAP with BUG-0379 |
| bugfix/BUG-0413 | NO ENTRY | 805 | 1 | 2026-03-21 | `src/internal/validate-command.ts` — CONFLICT; no tracker entry; orphan candidate |
| bugfix/BUG-0415 | fixed | 103 | 0 | 2026-03-20 | `src/store/index.ts` — OVERLAP with BUG-0421 |
| bugfix/BUG-0418 | fixed | 103 | 0 | 2026-03-20 | `src/cli/build.ts` |
| bugfix/BUG-0420 | reopened | 805 | 0 | 2026-03-20 | `src/coordination/pubsub.ts` — REOPENED; awaiting fixer |
| bugfix/BUG-0421 | fixed | 805 | 0 | 2026-03-20 | `src/store/index.ts` — OVERLAP with BUG-0415 |
| bugfix/BUG-0435 | fixed | 805 | 0 | 2026-03-21 | `src/swarm/scaling.ts` |
| bugfix/BUG-0450 | reopened | 805 | 0 | 2026-03-21 | `packages/loaders/src/loaders/json.ts` — REOPENED; awaiting fixer |
| bugfix/BUG-0452 | pending | 805 | 0 | 2026-03-21 | `src/pregel/checkpointing.ts` — OVERLAP with BUG-0453; fix commit present, tracker=pending |
| bugfix/BUG-0453 | fixed | 805 | 1 | 2026-03-21 | `src/pregel/checkpointing.ts` — CONFLICT; OVERLAP with BUG-0452 |
| bugfix/BUG-0454 | fixed | 15 | 0 | 2026-03-21 | `src/hitl/interrupt.ts` |
| bugfix/BUG-0455 | fixed | 15 | 0 | 2026-03-21 | `src/pregel/execution.ts` |
| bugfix/BUG-0456 | fixed | 15 | 0 | 2026-03-21 | `src/pregel/streaming.ts` |
| bugfix/BUG-0457 | fixed | 15 | 0 | 2026-03-21 | `src/__tests__/hitl.test.ts` |
| bugfix/BUG-0458 | pending | 805 | 0 | 2026-03-15 | `src/???` — startTimes map cap; tracker=pending; fix commit present |

## Conflict Branches (5)
- BUG-0355: 1 conflict in `packages/stores/src/redis/index.ts` — fixer must delete + recreate from main
- BUG-0356: 2 conflicts in `packages/stores/src/postgres/index.ts` — fixer must delete + recreate from main
- BUG-0378: 1 conflict in `src/swarm/pool.ts` — fixer must delete + recreate from main
- BUG-0413: 1 conflict in `src/internal/validate-command.ts` — no tracker entry; fixer must investigate
- BUG-0453: 1 conflict in `src/pregel/checkpointing.ts` — OVERLAP with BUG-0452; fixer must recreate

## File Overlap Pairs (4)
1. `src/models/ollama.ts`: BUG-0357 (0 behind, rebased) + BUG-0377 (805 behind) — MEDIUM; BUG-0377 will conflict post-BUG-0357 merge
2. `src/swarm/agent-node.ts`: BUG-0379 (805 behind) + BUG-0410 (105 behind) — MEDIUM
3. `src/store/index.ts`: BUG-0415 (103 behind) + BUG-0421 (805 behind) — LOW
4. `src/pregel/checkpointing.ts`: BUG-0452 (pending, 805 behind) + BUG-0453 (fixed, conflict) — HIGH; resolve conflict + status mismatch

## Priority Queue
1. BUG-0357 — 0 behind (rebased C257), clean, fixed — MERGE READY
2. BUG-0409 — 33 behind, clean, fixed — MERGE READY
3. BUG-0454/0455/0456/0457 — 15 behind, clean, fixed — MERGE READY
4. BUG-0359/0366 — 58 behind, clean, fixed
5. BUG-0295 — 74 behind, clean, fixed
