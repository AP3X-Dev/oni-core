# Bug Pipeline Daily Digest

**Generated:** 2026-03-20T14:39:19Z
**Period:** Last 24 hours

---

## Pipeline Snapshot

| Metric | Value |
|--------|-------|
| Active Bugs | 51 |
| Pending | 0 |
| In Progress | 0 |
| Fixed (awaiting validation) | 35 |
| Reopened | 0 |
| Blocked | 16 |

## Severity Breakdown

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 16 |
| Medium | 32 |
| Low | 2 |

## 24h Activity

| Metric | Value |
|--------|-------|
| Bugs Found | 6 |
| Bugs Fixed | 0 |
| Bugs Verified | 0 |
| Throughput | 0 bugs/day |
| Mean Time to Fix | N/A (no recent fixes) |
| Mean Time to Verify | N/A (no verifications) |
| Reopen Rate | 0% |
| First-Pass Fix Rate | N/A |
| Queue Drain Rate | 0.00 (0 verified / 6 found) |
| Blocked Ratio | 31.4% |

## Top Problem Files

| File | Bug Count |
|------|-----------|
| `src/swarm/pool.ts` | 5 |
| `src/harness/memory/ranker.ts` | 3 |
| `src/checkpointers/redis.ts` | 2 |
| `src/pregel/index.ts` | 2 |
| `packages/a2a/src/server/index.ts` | 2 |

## Top Categories

| Category | Count |
|----------|-------|
| security-injection | 11 |
| test-regression | 8 |
| logic-bug | 8 |
| missing-error-handling | 5 |
| type-error | 5 |

## Agent Health

| Agent | Last Activity | Status |
|-------|--------------|--------|
| Hunter | 2026-03-20T05:23:00Z | STALE (9h ago) |
| Fixer | 2026-03-20T12:36:39Z | RECENT (2h ago) |
| Validator | 2026-03-20T04:07:00Z | STALE (10.5h ago) |

## Bottleneck Analysis

**CRITICAL VALIDATOR BOTTLENECK:** 35 bugs remain in `fixed` status (awaiting validation), with zero verified in the last 24h. Last Validator pass was at 04:07Z (~10.5 hours ago) and has completely stalled. The Validator must be restarted to clear the queue.

**High Blocked Ratio (31.4%):** 16 of 51 active bugs are blocked. Many are confirmed false positives (already fixed on main) or require human decisions (architectural, API changes, policy blocks). Triage needed to close or unblock suspected false positives.

**Queue Drain Critical (0.00):** Zero throughput for another 24h cycle. The Fixer produced 35 fixes but nothing is making it through validation to the verified state.

**Hunter Stale (9h):** Last scan at 05:23Z. Restart required to detect new bugs.

**Fixer Recently Active:** Fixer pass at 12:36Z is encouraging — high productivity on bug fixes. However output stalls at validation gate.

## Trend (vs Previous Digest at 14:16Z)

| Metric | Previous | Current | Direction |
|--------|----------|---------|-----------|
| Active Bugs | 37 | 51 | ↑ |
| Fixed (queued) | 24 | 35 | ↑ |
| Blocked | 12 | 16 | ↑ |
| Throughput | 0 bugs/day | 0 bugs/day | → |
| Blocked Ratio | 32.4% | 31.4% | ↓ |
| Hunter Status | STALE (9h) | STALE (9h) | → |
| Validator Status | STALE (10h) | STALE (10.5h) | ↓ |

**Assessment:** Active bugs increased from 37 to 51 — primarily because new bugs were found (6 in last 24h) and the Fixer produced 11 new fixes (35 total fixed, up from 24 previously). The Validator remains completely stalled at 04:07Z, so all these fixes are accumulating in the queue. Blocked count increased from 12 to 16 (4 new blocks in latest fixes). The Validator restart is URGENT to prevent this queue from growing further.

## Blocked — Needs Human Attention

### Security (requires architectural decision)

- **BUG-0205** (`critical` / `security-injection`) — `packages/tools/src/code-execution/node-eval.ts:57`: Unsandboxed code execution, full RCE risk. Auto-blocked after 3 attempts. Needs isolated-vm or container-level sandboxing.

### Test regressions

- **BUG-0235** (`high` / `test-regression`) — `src/errors.ts:44`: `ONIError.toJSON()` field mismatch. CI Sentinel confirmed real bug (13 tests fail). Already fixed on main per fixer, but branch may have stale state.
- **BUG-0236** (`high` / `test-regression`) — `src/checkpointers/redis.ts:52`: RedisCheckpointer mock issue. Confirmed false positive by fixer.

### Suspected false positives (need Hunter re-evaluation)

- **BUG-0244** (`medium` / `security-injection`) — `src/cli/build.ts:41`: `spawn()` shell:true. Already fixed on main, branch had it backwards.
- **BUG-0246** (`high` / `race-condition`) — `src/guardrails/budget.ts:51`: Auto-blocked after 3 attempts. Synchronous method, may be false positive.
- **BUG-0250** (`medium` / `memory-leak`) — `src/harness/loop/inference.ts:156`: setTimeout handle. Already stored + unref at lines 159-160 per fixer.
- **BUG-0259** (`medium` / `logic-bug`) — `src/harness/memory/ranker.ts:41`: Relevance filter. False positive per fixer (recencyScore already 0).
- **BUG-0260** (`medium` / `logic-bug`) — `src/harness/memory/ranker.ts:94`: `rankAndLoad` empty return. Already logs warning per fixer.
- **BUG-0262** (`medium` / `missing-error-handling`) — `packages/tools/src/web-search/brave.ts:45`: `res.json()` try/catch. Already wrapped per fixer.
- **BUG-0268** (`medium` / `missing-error-handling`) — `src/harness/loop/index.ts:55`: `fireSessionStart` hook error. Fixed by fixer (hook already wrapped).
- **BUG-0277** (`high` / `missing-error-handling`) — `src/swarm/pool.ts:209`: `onComplete` hook error. Already fixed on main per fixer.
- **BUG-0286** (`medium` / `security-config`) — `src/models/google.ts:383`: No raw logging. Confirmed false positive by fixer (silent catch).

### Policy blocks

- **BUG-0191** (`low` / `dead-code`) — `src/config/types.ts:76`: Unused `plugins` field in ONIConfig. Awaiting API change decision (remove field vs implement plugin loading).
- **BUG-0253** (`medium` / `logic-bug`) — `src/swarm/self-improvement/experiment-log.ts:57`: ExperimentLog delta direction. Fix applied, stuck in blocked status.
- **BUG-0275** (`high` / `api-contract-violation`) — `src/models/openrouter.ts:472`: finish_reason check placement. False positive — already fixed on main per fixer.
- **BUG-0278** (`high` / `type-error`) — `src/checkpointers/redis.ts:180`: Redis checkpoint validation. Awaiting validation gate clear.

---

*Generated by Bug Pipeline Digest Agent*
