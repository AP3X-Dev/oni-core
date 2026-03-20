# Bug Pipeline Daily Digest

**Generated:** 2026-03-20T21:00:00Z
**Period:** Last 24 hours (2026-03-19T21:00:00Z to 2026-03-20T21:00:00Z)

---

## Pipeline Snapshot

| Metric | Value |
|--------|-------|
| Active Bugs | 52 |
| Pending | 1 |
| In Progress | 0 |
| Fixed (awaiting validation) | 35 |
| Reopened | 0 |
| Blocked | 16 |

## Severity Breakdown

| Severity | Count |
|----------|-------|
| Critical | 2 |
| High | 18 |
| Medium | 21 |
| Low | 11 |

## 24h Activity

| Metric | Value |
|--------|-------|
| Bugs Found | 0 |
| Bugs Fixed | 0 |
| Bugs Verified | 5 |
| Throughput | 5 bugs/day |
| Mean Time to Fix | ~2h |
| Mean Time to Verify | ~1h 30m |
| Reopen Rate | 0% |
| First-Pass Fix Rate | 100% |
| Queue Drain Rate | n/a (no new bugs found) |
| Blocked Ratio | 30.8% |

## Top Problem Files

| File | Bug Count |
|------|-----------|
| `src/swarm/pool.ts` | 5 |
| `src/harness/memory/ranker.ts` | 3 |
| `src/swarm/agent-node.ts` | 2 |
| `src/pregel/index.ts` | 2 |
| `src/models/google.ts` | 2 |
| `src/checkpointers/redis.ts` | 2 |

## Top Categories

| Category | Count |
|----------|-------|
| security-injection | 11 |
| test-regression | 8 |
| logic-bug | 8 |
| type-error | 5 |
| missing-error-handling | 5 |
| security-config | 3 |
| api-contract-violation | 3 |

## Agent Health

| Agent | Last Activity | Status |
|-------|--------------|--------|
| Hunter | 2026-03-20T05:23:00Z | STALE (15.5h ago) |
| Fixer | 2026-03-20T12:36:39Z | STALE (8.5h ago) |
| Validator | 2026-03-20T04:07:00Z | STALE (16.8h ago) |

## Bottleneck Analysis

**HUNTER OFFLINE:** Last scan 15.5 hours ago (05:23Z). No new bugs detected in 24h window. Hunter loop appears dormant — needs restart to resume continuous scanning.

**FIXER STALLED:** Last completion at 12:36:39Z. No fixes committed in last 8.5 hours. 35 bugs remain in `fixed` status awaiting validation, but Fixer queue appears empty or agent is stuck.

**VALIDATOR CRITICAL BACKLOG:** 35 bugs queued in `fixed` status with only 5 verified in the last 24h. Last verification completed at 2026-03-19T23:18:00Z (22h ago). Validator must be restarted to clear the backlog.

**Stalled Pipeline:** With Hunter offline, Fixer inactive, and Validator severely behind, the entire bug pipeline is effectively paused. Only 5 bugs have moved through to verified status in 24h while 35 remain stuck in fixed status.

**High Blocked Ratio (30.8%):** 16 of 52 active bugs are blocked — many are confirmed false positives or require human architectural decisions (e.g., BUG-0205 security sandboxing, BUG-0191 plugin API decision).

## Trend (vs Previous Digest)

| Metric | Previous | Today | Direction |
|--------|----------|-------|-----------|
| Active Bugs | 52 | 52 | → |
| Pending | 0 | 1 | ↑ (+1) |
| Blocked | 16 | 16 | → |
| Fixed (queued) | 36 | 35 | ↓ (-1) |
| Bugs Found (24h) | 24 | 0 | ↓ (-24) |
| Bugs Verified (24h) | 7 | 5 | ↓ (-2) |
| Throughput | 7 bugs/day | 5 bugs/day | ↓ |

**Assessment:** Pipeline velocity declining. Hunter offline for 15+ hours (zero new bugs found today vs 24 yesterday). Validator throughput halved (5 verified vs 7). Fixer inactive for 8.5 hours. Fixed queue remains at 35 bugs waiting for Validator. Active bug count stable but throughput degrading. **Action required immediately:** Restart all three agents (Hunter, Fixer, Validator) to resume pipeline flow.

## Blocked — Needs Human Attention

### Critical Security (requires architectural decision)

- **BUG-0205** (`critical` / `security-injection`) — `packages/tools/src/code-execution/node-eval.ts:57`: Unsandboxed code execution, full RCE risk. Auto-blocked after 3 attempts. ESM import() bypasses CJS-level patches; --experimental-permission has no network permission. Needs isolated-vm or container-level sandboxing.

### Test Regressions (CI-confirmed real bugs)

- **BUG-0235** (`high` / `test-regression`) — `src/errors.ts:44`: `ONIError.toJSON()` field mismatch. 13 tests fail in CI. Already fixed on main per fixer assessment.
- **BUG-0236** (`high` / `test-regression`) — `src/checkpointers/redis.ts:52`: RedisCheckpointer mock issue. Tests fail in CI.

### False Positives & Already-Fixed (need closure)

- **BUG-0244** (`medium` / `security-injection`) — `src/cli/build.ts:41`: Already fixed on main.
- **BUG-0246** (`high` / `race-condition`) — `src/guardrails/budget.ts:51`: Auto-blocked after 3 attempts. Likely false positive.
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
