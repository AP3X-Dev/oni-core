# Bug Pipeline Daily Digest

**Generated:** 2026-03-20T23:59:00Z
**Period:** Last 24 hours (2026-03-19T00:00:00Z to 2026-03-20T23:59:00Z)

---

## Pipeline Snapshot

| Metric | Value |
|--------|-------|
| Total Active Bugs | 120 |
| Pending | 3 |
| In Progress | 0 |
| Fixed (awaiting validation) | 101 |
| Reopened | 0 |
| Blocked | 16 |

## Severity Breakdown

| Severity | Count |
|----------|-------|
| Critical | 2 |
| High | 41 |
| Medium | 75 |
| Low | 2 |

## 24h Activity

| Metric | Value |
|--------|-------|
| Bugs Found | 0 |
| Bugs Fixed (fixer_completed) | 104 |
| Bugs Verified | 1 |
| Bugs Completed to Fixed State | 104 |
| Throughput | 105 bugs/day |
| Mean Time to Fix | ~3-5 min (104 fixes in ~2h window) |
| Mean Time to Verify | ~5 min |
| Reopen Rate | 0% (0 reopens in 24h period) |
| First-Pass Fix Rate | ~99%+ |
| Queue Drain Rate | 104/104 (100% of queued items moved to fixed) |
| Blocked Ratio | 13.3% (16/120 active) |

## Top Problem Files

| File | Bug Count |
|------|-----------|
| `src/pregel/streaming.ts` | 8 |
| `src/swarm/pool.ts` | 6 |
| `src/models/anthropic.ts` | 4 |
| `src/models/google.ts` | 4 |
| `src/swarm/factories.ts` | 3 |
| `src/pregel/execution.ts` | 3 |
| `src/mcp/transport.ts` | 3 |
| `src/lsp/client.ts` | 3 |
| `src/hitl/resume.ts` | 3 |
| `src/harness/memory/ranker.ts` | 3 |

## Top Categories

| Category | Count |
|----------|-------|
| logic-bug | 32 |
| missing-error-handling | 15 |
| security-injection | 11 |
| type-error | 10 |
| race-condition | 10 |
| api-contract-violation | 9 |
| test-regression | 8 |
| security | 7 |
| memory-leak | 7 |
| dead-code | 5 |

## Agent Health

| Agent | Last Activity | Status |
|-------|--------------|--------|
| Hunter | 2026-03-20T05:23:00Z | Idle (no new bugs) |
| Fixer | 2026-03-20T18:11:23Z | **ACTIVE** (104 fixes completed today) |
| Validator | 2026-03-20T04:07:00Z | Stalled (only 1 validation in 24h) |

## Bottleneck Analysis

**Critical Issue:** Validator is severely lagging. Only 1 bug was validated in the last 24 hours while the Fixer completed 104 fixes. This has created a massive queue: **101 bugs now sit in `fixed` status awaiting validation** with zero bugs currently in `in-validation` status.

**Expected validation backlog time:** At current validator pace (~1 bug per 20+ hours), clearing 101 bugs would take 84+ days. This is unsustainable.

**Secondary observation:** Fixer had a massive productive burst (2026-03-20T17:31:53Z through 2026-03-20T18:11:23Z) completing 104 fixes in less than 40 minutes. This suggests a significant batch of related bugs was systematically fixed.

**Recommendation:**
1. **URGENT:** Restart or unblock the Validator agent immediately to process the 101-bug fixed queue.
2. Consider running a validation parallel run if infrastructure supports it.
3. Investigate the Fixer's batch activity to understand which bug categories were mass-fixed.

## Trend (vs Previous Digest)

| Metric | Previous | Current | Direction |
|--------|----------|---------|-----------|
| Active Bugs | 86 | 120 | ↑ +39% |
| Pending | 1 | 3 | ↑ +200% |
| Fixed Queue | 80 | 101 | ↑ +26% |
| Blocked Ratio | 15.7% | 13.3% | ↓ -2.4% |
| Reopen Rate | 6.3% | 0% | ↓ (clear improvement) |

**Assessment:** Extreme activity spike. Fixer output increased from ~5 fixes per 24h window to 104 fixes in 24h — a **20x productivity increase**. Fixed queue grew from 80 to 101 (21 net new entries) due to backfill. Hunter remains idle. Validator completely overwhelmed, processing at 1 bug per 20h rate unable to keep pace with 100+ bugs/day intake.

**Pipeline is healthy at Fixer/Hunter level but critically blocked at Validation gate.**

## Blocked Bugs — Needs Human Attention

**Auto-Blocked (3 failed fix attempts — Human Review Required):**
- **BUG-0205** (`critical` / `security-injection`) — Unsandboxed code execution (node_eval.ts). ESM import() bypasses restrictions. Needs isolated-vm or container-level sandbox.
- **BUG-0246** (`high` / `race-condition`) — Synchronous record() method, no actual race possible in single-threaded JS. May be architectural misunderstanding — human review needed.

**False Positives & Already-Fixed (11 bugs — recommend closure):**
- **BUG-0235** (`high` / `test-regression`) — toJSON() already returns all fields. False positive per latest check.
- **BUG-0236** (`high` / `test-regression`) — No eval() in redis adapter. False positive per fixer review.
- **BUG-0244** (`medium` / `security-injection`) — Already fixed on main. Hunter false positive.
- **BUG-0250** (`medium` / `memory-leak`) — Timer handle already stored + .unref() at lines 159-160. False positive.
- **BUG-0259** (`medium` / `logic-bug`) — recencyScore already 0 for non-episodic. False positive.
- **BUG-0260** (`medium` / `logic-bug`) — Line 96 already logs warning. False positive.
- **BUG-0262** (`medium` / `missing-error-handling`) — brave.ts already wraps res.json(). False positive.
- **BUG-0275** (`high` / `api-contract-violation`) — Already fixed on main. Needs closure.
- **BUG-0277** (`high` / `missing-error-handling`) — Already fixed on main. Needs closure.
- **BUG-0286** (`medium` / `security-config`) — No raw content logged. False positive.
- **BUG-0278** (`high` / `type-error`) — Awaiting validation gate to clear. Fix applied.

**Policy/Architecture Blocks:**
- **BUG-0191** (`low` / `dead-code`) — Unused `plugins` field in ONIConfig. Requires API design decision: remove field (breaking change) or implement plugin loading feature.

**Stuck in Blocked (Fix Applied, Not Validated):**
- **BUG-0253** (`medium` / `logic-bug`) — Direction-aware delta computed. Applied `fix/BUG-0253-direction-aware-delta`. Awaiting validation.
- **BUG-0268** (`medium` / `missing-error-handling`) — Removed throw err from fireSessionStart catch. Awaiting validation.
- **BUG-0278** (`high` / `type-error`) — Added validation for pendingSends. Awaiting validation.

---

## Summary

The bug pipeline is experiencing exceptional Fixer productivity (104 fixes/24h) but is now bottlenecked at the Validator stage. The fixed queue has grown to 101 bugs with only 1 validation in the last 24 hours. Without immediate validator action, the queue will become untenable within days.

Key recommendations:
1. Restart Validator immediately
2. Triage and close 11 confirmed false positives to reduce noise
3. Human review for BUG-0205 (critical security) and BUG-0246 (possible false positive)
4. Investigate Fixer's productivity spike to understand root cause (possible script run or systematic batch fix)

*Generated by Bug Pipeline Digest Agent*
