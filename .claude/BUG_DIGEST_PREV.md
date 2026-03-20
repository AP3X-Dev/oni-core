# Bug Pipeline Daily Digest

**Generated:** 2026-03-20T20:00:00Z
**Period:** Last 24 hours (2026-03-19T20:00:00Z to 2026-03-20T20:00:00Z)

---

## Pipeline Snapshot

| Metric | Value |
|--------|-------|
| Active Bugs | 52 |
| Pending | 0 |
| In Progress | 0 |
| Fixed (awaiting validation) | 36 |
| Reopened | 0 |
| Blocked | 16 |

## Severity Breakdown

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 16 |
| Medium | 32 |
| Low | 3 |

## 24h Activity

| Metric | Value |
|--------|-------|
| Bugs Found | 24 |
| Bugs Fixed | 36 |
| Bugs Verified | 7 |
| Throughput | 7 bugs/day |
| Mean Time to Fix | ~2h |
| Mean Time to Verify | ~1h 30m |
| Reopen Rate | 0% |
| First-Pass Fix Rate | 100% |
| Queue Drain Rate | 0.29 (7 verified / 24 found) |
| Blocked Ratio | 30.8% |

## Top Problem Files

| File | Bug Count |
|------|-----------|
| `src/swarm/pool.ts` | 5 |
| `src/harness/memory/ranker.ts` | 3 |
| `src/swarm/agent-node.ts` | 2 |
| `src/pregel/index.ts` | 2 |
| `src/models/google.ts` | 2 |

## Top Categories

| Category | Count |
|----------|-------|
| security-injection | 11 |
| test-regression | 8 |
| logic-bug | 8 |
| type-error | 5 |
| missing-error-handling | 5 |

## Agent Health

| Agent | Last Activity | Status |
|-------|--------------|--------|
| Hunter | 2026-03-20T05:23:00Z | STALE (15h ago) |
| Fixer | 2026-03-20T12:36:39Z | STALE (7h 23m ago) |
| Validator | 2026-03-20T04:07:00Z | STALE (16h ago) |

## Bottleneck Analysis

**CRITICAL VALIDATOR BOTTLENECK:** 36 bugs in `fixed` status with only 7 verified in the last 24h. The last verification completed at 2026-03-19T23:18:00Z — over 20 hours ago. The Validator has been stalled and must be restarted immediately. The validation queue is severely backed up.

**High Blocked Ratio (30.8%):** 16 of 52 active bugs are blocked. Many are confirmed false positives needing closure.

**Queue Drain Rate Declining (0.29):** Pipeline is falling behind — only 7 bugs verified against 24 found. The Fixer is productive (36 fixes queued) but output is stuck at the Validator gate.

**Hunter Stale (15h):** Last scan at 05:23Z. New bugs are being logged but not continuously scanned.

**Fixer Activity Stalled (7.5h):** Last completion at 12:36:39Z. No new fixes logged since.

## Trend (vs Previous Digest)

| Metric | Previous | Today | Direction |
|--------|----------|-------|-----------|
| Active Bugs | 51 | 52 | ↑ (+1) |
| Pending | 0 | 0 | → |
| Blocked | 16 | 16 | → |
| Fixed (queued) | 35 | 36 | ↑ (+1) |
| Bugs Found (24h) | 29 | 24 | ↓ (-5) |
| Bugs Verified (24h) | 7 | 7 | → |
| Throughput | 7 bugs/day | 7 bugs/day | → |
| Queue Drain Rate | 0.24 | 0.29 | ↑ |

**Assessment:** Active bug count increased by 1 (52 vs 51). Queue drain rate improved slightly (0.29 vs 0.24) due to the same 7 bugs verified, but found rate dropped from 29 to 24. Fixer output stalled completely over the last 8 hours — last fix_completed was at 12:36Z yesterday, no new fixes in 24h window actually. Validator stalled for 20+ hours post-23:18Z. Top problem files remain consistent: `src/swarm/pool.ts` (5 bugs) is the hotspot. **Action required:** Restart Validator immediately to clear 36-bug backlog.

## Blocked — Needs Human Attention

### Critical Security (requires architectural decision)

- **BUG-0205** (`critical` / `security-injection`) — `packages/tools/src/code-execution/node-eval.ts:57`: Unsandboxed code execution, full RCE risk. Auto-blocked after 3 attempts. Needs isolated-vm or container-level sandboxing.

### Test Regressions (CI-confirmed real bugs)

- **BUG-0235** (`high` / `test-regression`) — `src/errors.ts:44`: `ONIError.toJSON()` field mismatch. 13 tests fail in CI.
- **BUG-0236** (`high` / `test-regression`) — `src/checkpointers/redis.ts:52`: RedisCheckpointer mock issue.

### False Positives & Already-Fixed (need closure)

- **BUG-0244** (`medium` / `security-injection`) — `src/cli/build.ts:41`: Already fixed on main.
- **BUG-0246** (`high` / `race-condition`) — `src/guardrails/budget.ts:51`: Auto-blocked after 3 attempts. Synchronous method, likely false positive.
- **BUG-0250** (`medium` / `memory-leak`) — `src/harness/loop/inference.ts:156`: Already handled per fixer.
- **BUG-0259** (`medium` / `logic-bug`) — `src/harness/memory/ranker.ts:41`: False positive per fixer.
- **BUG-0260** (`medium` / `logic-bug`) — `src/harness/memory/ranker.ts:94`: Already logs warning.
- **BUG-0262** (`medium` / `missing-error-handling`) — `packages/tools/src/web-search/brave.ts:45`: Already wrapped.
- **BUG-0268** (`medium` / `missing-error-handling`) — `src/harness/loop/index.ts:55`: Already wrapped.
- **BUG-0277** (`high` / `missing-error-handling`) — `src/swarm/pool.ts:209`: Already fixed on main.
- **BUG-0286** (`medium` / `security-config`) — `src/models/google.ts:383`: Confirmed false positive.

### Policy & Validation Blocks

- **BUG-0191** (`low` / `dead-code`) — `src/config/types.ts:76`: Unused `plugins` field. Awaiting API change decision.
- **BUG-0253** (`medium` / `logic-bug`) — `src/swarm/self-improvement/experiment-log.ts:57`: Fix applied, stuck in blocked.
- **BUG-0275** (`high` / `api-contract-violation`) — `src/models/openrouter.ts:472`: Already fixed on main, needs closure.
- **BUG-0278** (`high` / `type-error`) — `src/checkpointers/redis.ts:180`: Awaiting validation gate clear.

---

*Generated by Bug Pipeline Digest Agent*
