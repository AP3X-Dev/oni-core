# Branch Map — Cycle 256

**Generated:** 2026-03-22T01:15:00Z
**Main HEAD:** 9cbc120
**Total Branches:** 34 (was 37; 0 deleted, 0 net new this cycle)

| Branch | Status | Behind Main | Conflicts | Last Commit | Notes |
|---|---|---|---|---|---|
| bugfix/BUG-0295 | fixed | 59 | 0 | 2026-03-21 | `src/errors.ts` — toJSON stack leak |
| bugfix/BUG-0355 | fixed | 789 | 1 | 2026-03-20 | `packages/stores/src/redis/index.ts` — CONFLICT; recreate from main |
| bugfix/BUG-0356 | fixed | 789 | 2 | 2026-03-20 | `packages/stores/src/postgres/index.ts` — 2 CONFLICTS; recreate from main |
| bugfix/BUG-0357 | fixed | 9 | 0 | 2026-03-21 | `src/models/ollama.ts` — in-stream error detection |
| bugfix/BUG-0358 | fixed | 789 | 0 | 2026-03-20 | `src/harness/hooks-engine.ts` |
| bugfix/BUG-0359 | fixed | 43 | 0 | 2026-03-21 | `src/harness/loop/index.ts` |
| bugfix/BUG-0366 | fixed | 43 | 0 | 2026-03-21 | `src/harness/memory/index.ts` |
| bugfix/BUG-0376 | fixed | 122 | 0 | 2026-03-20 | `src/models/openai.ts` — JSON parse embed |
| bugfix/BUG-0377 | fixed | 789 | 0 | 2026-03-20 | `src/models/ollama.ts` — OVERLAP with BUG-0357 |
| bugfix/BUG-0378 | fixed | 789 | 1 | 2026-03-20 | `src/swarm/pool.ts` — CONFLICT; recreate from main |
| bugfix/BUG-0379 | fixed | 789 | 0 | 2026-03-20 | `src/swarm/agent-node.ts` — OVERLAP with BUG-0410 |
| bugfix/BUG-0383 | fixed | 121 | 0 | 2026-03-20 | `src/swarm/snapshot.ts` |
| bugfix/BUG-0388 | fixed | 122 | 0 | 2026-03-20 | `src/stream-events.ts` |
| bugfix/BUG-0389 | fixed | 789 | 0 | 2026-03-20 | `src/testing/index.ts` |
| bugfix/BUG-0390 | fixed | 789 | 0 | 2026-03-20 | `src/checkpointers/namespaced.ts` |
| bugfix/BUG-0394 | fixed | 789 | 0 | 2026-03-21 | `src/swarm/tracer.ts` |
| bugfix/BUG-0400 | fixed | 789 | 0 | 2026-03-20 | `packages/tools/src/browser/firecrawl.ts` |
| bugfix/BUG-0404 | fixed | 789 | 0 | 2026-03-21 | `src/agents/define-agent.ts` — OVERLAP with BUG-0443; extreme divergence |
| bugfix/BUG-0409 | fixed | 18 | 0 | 2026-03-21 | `src/dlq.ts` — DLQ ID collision |
| bugfix/BUG-0410 | fixed | 90 | 0 | 2026-03-20 | `src/swarm/agent-node.ts` — OVERLAP with BUG-0379 |
| bugfix/BUG-0413 | fixed | 789 | 1 | 2026-03-21 | `src/internal/validate-command.ts` — CONFLICT; recreate from main |
| bugfix/BUG-0415 | fixed | 88 | 0 | 2026-03-20 | `src/store/index.ts` — OVERLAP with BUG-0421 |
| bugfix/BUG-0416 | fixed | 789 | 0 | 2026-03-20 | `src/streaming.ts` |
| bugfix/BUG-0417 | fixed | 789 | 0 | 2026-03-20 | `src/cli/dev.ts` |
| bugfix/BUG-0418 | fixed | 88 | 0 | 2026-03-20 | `src/cli/build.ts` |
| bugfix/BUG-0419 | fixed | 789 | 0 | 2026-03-20 | `packages/tools/src/stripe/index.ts` |
| bugfix/BUG-0420 | fixed | 789 | 0 | 2026-03-20 | `src/coordination/pubsub.ts` |
| bugfix/BUG-0421 | fixed | 789 | 0 | 2026-03-20 | `src/store/index.ts` — OVERLAP with BUG-0415 |
| bugfix/BUG-0422 | fixed | 789 | 0 | 2026-03-20 | `packages/integrations/src/adapter/index.ts` |
| bugfix/BUG-0430 | fixed | 41 | 0 | 2026-03-21 | `src/harness/loop/index.ts` — OVERLAP with BUG-0359 |
| bugfix/BUG-0435 | fixed | 789 | 0 | 2026-03-21 | `src/swarm/scaling.ts` |
| bugfix/BUG-0443 | fixed | 0 | 0 | 2026-03-21 | `src/agents/define-agent.ts` — REBASED C256; OVERLAP with BUG-0404 |
| bugfix/BUG-0450 | fixed | 789 | 0 | 2026-03-21 | `packages/loaders/src/loaders/json.ts` |
| bugfix/BUG-0452 | fixed | 789 | 0 | 2026-03-21 | `src/pregel/checkpointing.ts` |

## Conflict Branches (4)
- BUG-0355: 1 conflict in `packages/stores/src/redis/index.ts` — fixer must delete + recreate from main
- BUG-0356: 2 conflicts in `packages/stores/src/postgres/index.ts` — fixer must delete + recreate from main
- BUG-0378: 1 conflict in `src/swarm/pool.ts` — fixer must delete + recreate from main
- BUG-0413: 1 conflict in `src/internal/validate-command.ts` — fixer must delete + recreate from main

## File Overlap Pairs (6)
1. `src/agents/define-agent.ts`: BUG-0404 (789 behind) + BUG-0443 (0 behind, rebased) — HIGH risk; merge BUG-0443 first
2. `src/models/ollama.ts`: BUG-0357 (9 behind) + BUG-0377 (789 behind) — MEDIUM; BUG-0377 may conflict post-BUG-0357 merge
3. `src/swarm/agent-node.ts`: BUG-0379 (789 behind) + BUG-0410 (90 behind) — MEDIUM
4. `src/harness/loop/index.ts`: BUG-0359 (43 behind) + BUG-0430 (41 behind) — MEDIUM
5. `src/store/index.ts`: BUG-0415 (88 behind) + BUG-0421 (789 behind) — LOW
6. `packages/tools/src/browser/firecrawl.ts`: BUG-0400 (789 behind) — previously overlapped BUG-0428 (now merged)

## Priority Queue
1. BUG-0443 — 0 behind (rebased C256), clean, validated — MERGE READY
2. BUG-0357 — 9 behind, clean, validated — MERGE READY
3. BUG-0409 — 18 behind, clean, validated — MERGE READY
4. BUG-0430 — 41 behind, clean, validated
5. BUG-0366/0359 — 43 behind, clean, validated
