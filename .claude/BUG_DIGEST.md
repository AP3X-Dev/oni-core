# Bug Pipeline Daily Digest

**Generated:** 2026-03-20T09:30:45Z
**Period:** Last 24 hours

---

## Pipeline Snapshot

| Metric | Value |
|--------|-------|
| Active Bugs | 48 |
| Pending | 0 |
| In Progress | 0 |
| Fixed (awaiting validation) | 32 |
| Reopened | 0 |
| Blocked | 16 |

## Severity Breakdown

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 16 |
| Medium | 29 |
| Low | 2 |

## 24h Activity

| Metric | Value |
|--------|-------|
| Bugs Found | 49 |
| Bugs Fixed | 42 |
| Bugs Verified | 12 |
| Throughput | 12 bugs/day |
| Mean Time to Fix | ~11.5h |
| Mean Time to Verify | ~3h |
| Reopen Rate | 0% (verified batch) |
| First-Pass Fix Rate | 100% (verified batch) |
| Queue Drain Rate | 0.24 |
| Blocked Ratio | 33.3% |

## Top Problem Files

| File | Bug Count |
|------|-----------|
| `src/swarm/pool.ts` | 5 |
| `src/harness/memory/ranker.ts` | 3 |
| `packages/a2a/src/server/index.ts` | 2 |
| `src/swarm/agent-node.ts` | 2 |
| `src/models/google.ts` | 2 |

## Top Categories

| Category | Count |
|----------|-------|
| security (all variants) | 15 |
| test-regression | 8 |
| logic-bug | 7 |
| type-error | 5 |
| missing-error-handling | 5 |

## Agent Health

| Agent | Last Activity | Status |
|-------|--------------|--------|
| Hunter | 2026-03-19T23:05:00Z | active |
| Fixer | 2026-03-20T09:06:39Z | active |
| Validator | 2026-03-20T04:07:00Z | active |

## Bottleneck Analysis

**Validator is the critical bottleneck:** 32 bugs are fixed and awaiting validation with 0 currently in-validation. The Validator's last pass was over 5 hours ago (04:07Z). The Fixer has been highly productive but the fixed queue is not draining. **Recommendation:** Urgently trigger Validator passes to clear the massive fixed queue.

**Queue Drain Rate at 0.24** — the pipeline is falling far behind. 49 bugs found vs only 12 verified. The Validator must increase throughput significantly to prevent indefinite backlog growth.

**Blocked ratio at 33.3%** — 16 of 48 active bugs are blocked. At least 10 are false positives (already fixed on main) needing Hunter re-evaluation or human triage. Consider a bulk false-positive sweep to reduce noise.

## Trend (vs Previous Digest)

| Metric | Yesterday | Today | Direction |
|--------|-----------|-------|-----------|
| Active Bugs | 49 | 48 | ↓ |
| Throughput | 12 | 12 | → |
| Reopen Rate | 6.3% | 0% | ↓ |
| Blocked Ratio | 32.7% | 33.3% | ↑ |

Active bug count decreased by 1 (12 verified, net reduction). Throughput stable at 12/day. Reopen rate dropped to 0% for the latest verified batch — all 12 bugs fixed correctly on first attempt. Blocked ratio ticked up slightly. `src/swarm/pool.ts` remains the persistent top problem file — this module needs structural attention. Security bugs (15) continue to dominate categories following recent security scans.

## Blocked — Needs Human Attention

- **BUG-0191** (`low` / `dead-code`) — `src/config/types.ts:76`: `plugins?: string[]` declared but unused. Decision needed: remove field or implement plugins.
- **BUG-0205** (`critical` / `security-injection`) — `packages/tools/src/code-execution/node-eval.ts:57`: `node_eval` executes LLM code unsandboxed. Auto-blocked after 3 attempts. Needs isolated-vm or container sandboxing.
- **BUG-0235** (`high` / `test-regression`) — `src/errors.ts:44`: False positive — tests pass on main.
- **BUG-0236** (`high` / `test-regression`) — `src/checkpointers/redis.ts:52`: False positive — no `eval()` call exists.
- **BUG-0244** (`medium` / `security-injection`) — `src/cli/build.ts:41`: False positive — `shell: true` already removed.
- **BUG-0246** (`high` / `race-condition`) — `src/guardrails/budget.ts:51`: Auto-blocked after 3 attempts. `record()` is synchronous.
- **BUG-0250** (`medium` / `memory-leak`) — `src/harness/loop/inference.ts:156`: False positive — timer handle already stored.
- **BUG-0253** (`medium` / `logic-bug`) — `src/swarm/self-improvement/experiment-log.ts:57`: Direction-aware delta fix applied but status stuck at blocked.
- **BUG-0259** (`medium` / `logic-bug`) — `src/harness/memory/ranker.ts:41`: False positive — recencyScore already 0.
- **BUG-0260** (`medium` / `logic-bug`) — `src/harness/memory/ranker.ts:94`: False positive — warning already logged.
- **BUG-0262** (`medium` / `missing-error-handling`) — `packages/tools/src/web-search/brave.ts:45`: False positive — try-catch present.
- **BUG-0268** (`medium` / `missing-error-handling`) — `src/harness/loop/index.ts:55`: fireSessionStart error handling fix applied but status stuck at blocked.
- **BUG-0275** (`high` / `api-contract-violation`) — `src/models/openrouter.ts:472`: False positive — already fixed.
- **BUG-0277** (`high` / `missing-error-handling`) — `src/swarm/pool.ts:209`: False positive — try-catch present.
- **BUG-0278** (`high` / `type-error`) — `src/checkpointers/redis.ts:180`: Redis checkpoint validation added but status stuck at blocked.
- **BUG-0286** (`medium` / `security-config`) — `src/models/google.ts:383`: False positive — no raw content logging.

---

*Generated by Bug Pipeline Digest Agent*
