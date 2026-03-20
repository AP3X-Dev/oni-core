# Bug Pipeline Daily Digest

**Generated:** 2026-03-20T07:54:45Z
**Period:** Last 24 hours

---

## Pipeline Snapshot

| Metric | Value |
|--------|-------|
| Active Bugs | 45 |
| Pending | 0 |
| In Progress | 3 |
| Fixed (awaiting validation) | 27 |
| Reopened | 0 |
| Blocked | 15 |

## Severity Breakdown

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 17 |
| Medium | 25 |
| Low | 2 |

## 24h Activity

| Metric | Value |
|--------|-------|
| Bugs Found | 46 |
| Bugs Fixed | 47 |
| Bugs Verified | 12 |
| Throughput | 12 bugs/day |
| Mean Time to Fix | ~8h |
| Mean Time to Verify | ~3h |
| Reopen Rate | 6.3% |
| First-Pass Fix Rate | 93.7% |
| Queue Drain Rate | 0.26 |
| Blocked Ratio | 33.3% |

## Top Problem Files

| File | Bug Count |
|------|-----------|
| `src/swarm/pool.ts` | 5 |
| `src/harness/memory/ranker.ts` | 3 |
| `packages/a2a/src/server/index.ts` | 2 |
| `src/swarm/agent-node.ts` | 2 |
| `src/pregel/index.ts` | 2 |

## Top Categories

| Category | Count |
|----------|-------|
| security (all variants) | 12 |
| logic-bug | 8 |
| test-regression | 7 |
| type-error | 5 |
| missing-error-handling | 5 |

## Agent Health

| Agent | Last Activity | Status |
|-------|--------------|--------|
| Hunter | 2026-03-20T22:10:00Z | active |
| Fixer | 2026-03-20T07:48:33Z | active |
| Validator | 2026-03-20T04:07:00Z | active |

## Bottleneck Analysis

**Validator is the critical bottleneck:** 27 bugs are fixed and awaiting validation with 0 currently in-validation. The Fixer has been highly productive (47 fixes in 24h) but the Validator has been idle since 04:07Z. **Recommendation:** Urgently trigger Validator passes to clear the massive fixed queue before it grows further.

**Blocked ratio rising to 33.3%** — 15 of 45 active bugs are blocked (up from 11). BUG-0253 (experiment-log direction), BUG-0259 (ranker), BUG-0268 (session-start hook), BUG-0275, BUG-0277 newly blocked as false positives. 10+ blocked bugs are false positives needing Hunter re-evaluation or human triage.

**Queue drain rate at 0.26** — pipeline is falling behind. 46 bugs found vs 12 verified means the backlog is growing.

## Trend (vs Previous Digest)

| Metric | Yesterday | Today | Direction |
|--------|-----------|-------|-----------|
| Active Bugs | 38 | 45 | ↑ |
| Throughput | 12 | 12 | → |
| Reopen Rate | 6.3% | 6.3% | → |
| Blocked Ratio | 28.9% | 33.3% | ↑ |

Active bug count increased by 7 as the Hunter found 46 new bugs while only 12 were verified. The Fixer is keeping pace (47 fixed) but the Validator is the bottleneck — 27 bugs await validation. `src/swarm/pool.ts` remains the persistent top problem file. Blocked ratio continues climbing; most blocked bugs are false positives from stale Hunter scans. Security-related bugs have overtaken logic-bug as the top category due to a new Hunter security scan.

## Blocked — Needs Human Attention

- **BUG-0191** (`low` / `dead-code`) — `src/config/types.ts:76`: `plugins?: string[]` declared but never consumed. Needs decision: remove field (API change) or implement plugin support.
- **BUG-0205** (`critical` / `security-injection`) — `packages/tools/src/code-execution/node-eval.ts:57`: `node_eval` executes LLM code with no sandbox. Auto-blocked after 3 attempts. Needs isolated-vm or container-level sandboxing.
- **BUG-0235** (`high` / `test-regression`) — `src/errors.ts:44`: False positive — tests pass on main. Hunter should re-evaluate.
- **BUG-0236** (`high` / `test-regression`) — `src/checkpointers/redis.ts:52`: False positive — no `eval()` call exists. Hunter should re-evaluate.
- **BUG-0244** (`medium` / `security-injection`) — `src/cli/build.ts:41`: False positive — `shell: true` already removed on main. Hunter should re-evaluate.
- **BUG-0246** (`high` / `race-condition`) — `src/guardrails/budget.ts:51`: Auto-blocked after 3 attempts. `record()` is synchronous — race may not apply. Needs human review.
- **BUG-0250** (`medium` / `memory-leak`) — `src/harness/loop/inference.ts:156`: False positive — timer handle already stored with `.unref()`. Hunter should re-evaluate.
- **BUG-0253** (`medium` / `logic-bug`) — `src/swarm/self-improvement/experiment-log.ts:57`: Direction-aware delta fix blocked. Needs validator review.
- **BUG-0259** (`medium` / `logic-bug`) — `src/harness/memory/ranker.ts:41`: False positive — recencyScore already 0 for non-episodic. Hunter should re-evaluate.
- **BUG-0260** (`medium` / `logic-bug`) — `src/harness/memory/ranker.ts:94`: False positive — warning already logged. Hunter should re-evaluate.
- **BUG-0262** (`medium` / `missing-error-handling`) — `packages/tools/src/web-search/brave.ts:45`: False positive — try-catch already present. Hunter should re-evaluate.
- **BUG-0275** (`high` / `api-contract-violation`) — `src/models/openrouter.ts:472`: False positive — already fixed on main. Hunter should re-evaluate.
- **BUG-0277** (`high` / `missing-error-handling`) — `src/swarm/pool.ts:209`: False positive — onComplete hook already wrapped in try-catch. Hunter should re-evaluate.
- **BUG-0284** (`medium` / `security-injection`) — `packages/stores/src/redis/index.ts:249`: Redis glob metacharacter injection in `listNamespaces()`. Pending fix.
- **BUG-0267** — *Note: BUG-0268 (`medium` / `missing-error-handling`) — `src/harness/loop/index.ts:55`: fireSessionStart error handling. Status shows blocked but marked fixed — may need reconciliation.*

---

*Generated by Bug Pipeline Digest Agent*
