# Branch Map — Cycle 253

**Generated:** 2026-03-21T10:23:00Z
**Main HEAD:** 3318840
**Total Branches:** 49 (was 51; 5 deleted, 3 net new)

---

## Summary

| Category | Count |
|---|---|
| Fixed (clean) | 39 |
| Fixed (conflict) | 5 |
| Verified (conflict) | 1 |
| Pending (new, no commits) | 4 |
| Pending (fix committed) | 1 |
| Reopened (worktree active) | 1 |

---

## Near-Current (≤30 behind)

| Branch | Ahead | Behind | Conflicts | Status | Files |
|---|---|---|---|---|---|
| bugfix/BUG-0359 | 1 | 0 | clean | fixed | src/harness/loop/index.ts |
| bugfix/BUG-0366 | 1 | 0 | clean | fixed | src/harness/memory/index.ts |
| bugfix/BUG-0444 | 1 | 0 | clean | pending (fix committed) | src/functional.ts |
| bugfix/BUG-0430 | 1 | 0 | clean | fixed (**REBASED C253**) | src/harness/loop/index.ts |
| bugfix/BUG-0295 | 1 | 18 | clean | fixed | src/errors.ts |
| bugfix/BUG-0343 | 1 | 29 | clean | fixed | src/harness/safety-gate.ts |

---

## Moderate Drift (30–100 behind)

| Branch | Ahead | Behind | Conflicts | Status | Files |
|---|---|---|---|---|---|
| bugfix/BUG-0406 | 1 | 48 | clean | fixed | src/swarm/factories.ts |
| bugfix/BUG-0407 | 1 | 47 | clean | fixed | src/swarm/pool.ts |
| bugfix/BUG-0410 | 1 | 47 | clean | fixed | src/swarm/agent-node.ts |
| bugfix/BUG-0415 | 1 | 45 | clean | fixed | src/store/index.ts |
| bugfix/BUG-0418 | 1 | 45 | clean | fixed | src/cli/build.ts |
| bugfix/BUG-0376 | 1 | 79 | clean | fixed | src/models/openai.ts |
| bugfix/BUG-0383 | 1 | 78 | clean | fixed | src/swarm/snapshot.ts |
| bugfix/BUG-0388 | 1 | 79 | clean | fixed | src/stream-events.ts |
| bugfix/BUG-0397 | 1 | 78 | clean | fixed | src/harness/harness.ts |
| bugfix/BUG-0387 | 1 | 85 | clean | fixed | src/index.ts |
| bugfix/BUG-0427 | 1 | 27 | clean | fixed | src/mcp/client.ts |
| bugfix/BUG-0428 | 1 | 27 | clean | fixed | packages/tools/src/browser/firecrawl.ts |
| bugfix/BUG-0435 | 1 | 27 | clean | fixed | src/swarm/scaling.ts |
| bugfix/BUG-0380 | 0 | 85 | clean | empty (0 ahead of main) | — |

---

## Critical Drift (>100 behind)

| Branch | Ahead | Behind | Conflicts | Status | Files |
|---|---|---|---|---|---|
| bugfix/BUG-0355 | 1 | 746 | **1** | reopened (worktree /tmp/bug0355-typecheck) | packages/stores/src/redis/index.ts |
| bugfix/BUG-0356 | 2 | 746 | **2** | fixed | src/store/postgres/index.ts |
| bugfix/BUG-0357 | 1 | 746 | clean | fixed | src/models/ollama.ts |
| bugfix/BUG-0358 | 1 | 746 | clean | fixed | src/harness/hooks-engine.ts |
| bugfix/BUG-0374 | 1 | 746 | **1** | fixed | packages/loaders/src/loaders/pdf.ts |
| bugfix/BUG-0375 | 1 | 746 | clean | fixed | src/checkpointers/sqlite.ts |
| bugfix/BUG-0377 | 1 | 746 | clean | fixed | src/models/ollama.ts |
| bugfix/BUG-0378 | 1 | 746 | **1** | fixed | src/swarm/pool.ts |
| bugfix/BUG-0379 | 1 | 746 | clean | fixed | src/swarm/agent-node.ts |
| bugfix/BUG-0381 | 1 | 746 | clean | fixed | src/tools/define.ts |
| bugfix/BUG-0384 | 1 | 746 | clean | fixed | src/checkpoint.ts, src/pregel/checkpointing.ts |
| bugfix/BUG-0389 | 1 | 746 | clean | fixed | src/testing/index.ts |
| bugfix/BUG-0390 | 1 | 746 | clean | fixed | src/checkpointers/namespaced.ts |
| bugfix/BUG-0392 | 1 | 746 | clean | fixed | src/swarm/mermaid.ts |
| bugfix/BUG-0393 | 1 | 746 | clean | fixed | src/swarm/tracer.ts |
| bugfix/BUG-0398 | 1 | 746 | clean | fixed | src/cli/test.ts |
| bugfix/BUG-0400 | 1 | 746 | clean | fixed | packages/tools/src/browser/firecrawl.ts |
| bugfix/BUG-0409 | 1 | 746 | clean | fixed | src/dlq.ts |
| bugfix/BUG-0412 | 1 | 746 | clean | fixed | src/swarm/graph.ts |
| bugfix/BUG-0413 | 1 | 746 | **1** | fixed | src/internal/validate-command.ts |
| bugfix/BUG-0416 | 1 | 746 | clean | fixed | src/streaming.ts |
| bugfix/BUG-0417 | 1 | 746 | clean | fixed | src/cli/dev.ts |
| bugfix/BUG-0419 | 1 | 746 | clean | fixed | packages/tools/src/stripe/index.ts |
| bugfix/BUG-0420 | 1 | 746 | clean | fixed | src/coordination/pubsub.ts |
| bugfix/BUG-0421 | 1 | 746 | clean | fixed | src/store/index.ts |
| bugfix/BUG-0422 | 1 | 746 | clean | fixed | packages/integrations/src/adapter/index.ts |
| bugfix/BUG-0434 | 1 | 746 | **2** | verified | src/swarm/pool.ts |

---

## New Branches (added this cycle)

| Branch | Ahead | Behind | Status | File |
|---|---|---|---|---|
| bugfix/BUG-0443 | 0 | 748 | pending (no commits yet) | src/agents/define-agent.ts |
| bugfix/BUG-0444 | 1 | 0 | pending (fix committed, tracker not updated yet) | src/functional.ts |
| bugfix/BUG-0445 | 0 | 748 | pending (no commits yet) | — |
| bugfix/BUG-0446 | 0 | 0 | pending (no commits yet) | src/pregel/execution.ts |
| bugfix/BUG-0447 | 0 | 748 | pending (no commits yet) | — |

---

## Conflict Branches (require fixer recreation)

| Branch | Conflicts | File |
|---|---|---|
| bugfix/BUG-0355 | 1 | packages/stores/src/redis/index.ts (worktree active) |
| bugfix/BUG-0356 | 2 | src/store/postgres/index.ts |
| bugfix/BUG-0374 | 1 | packages/loaders/src/loaders/pdf.ts |
| bugfix/BUG-0378 | 1 | src/swarm/pool.ts |
| bugfix/BUG-0413 | 1 | src/internal/validate-command.ts |
| bugfix/BUG-0434 | 2 | src/swarm/pool.ts (verified, 3-way overlap w/ 0378+0407) |

---

## File Overlap Pairs

| File | Branches | Risk |
|---|---|---|
| src/swarm/pool.ts | BUG-0378 + BUG-0407 + BUG-0434 | HIGH (3-way; 0378+0434 conflicted) |
| src/swarm/agent-node.ts | BUG-0379 + BUG-0410 | safe |
| src/store/index.ts | BUG-0415 + BUG-0421 | safe |
| packages/tools/src/browser/firecrawl.ts | BUG-0400 + BUG-0428 | safe |
| src/models/ollama.ts | BUG-0357 + BUG-0377 | safe |
| src/harness/loop/index.ts | BUG-0359 + BUG-0430 | safe (diff hunks non-overlapping) |

---

## Cycle 253 Actions

- **Deleted (5/5):** BUG-0436, BUG-0437, BUG-0438, BUG-0439, BUG-0440 — orphan branches (no tracker entries, no active worktrees; fix commits present but unentered in tracker)
- **Rebased (1/1):** BUG-0430 — was 9 behind, now ON MAIN HEAD (3318840). 0 conflicts. loop/index.ts finalizeMemory try/catch.
- **GC:** Skipped. Next at Cycle 258.
