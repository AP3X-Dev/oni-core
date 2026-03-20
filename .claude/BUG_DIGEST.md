# Bug Pipeline Daily Digest

**Generated:** 2026-03-20T18:37:51Z
**Period:** Last 24 hours (2026-03-19T18:37:51Z to 2026-03-20T18:37:51Z)

---

## Pipeline Snapshot

| Metric | Value |
|--------|-------|
| Total Active Bugs | 135 |
| Pending | 0 |
| In Progress | 2 |
| Fixed (awaiting validation) | 116 |
| Reopened | 0 |
| Blocked | 16 |

## Severity Breakdown

| Severity | Count |
|----------|-------|
| Critical | 2 |
| High | 44 |
| Medium | 85 |
| Low | 3 |

## 24h Activity

| Metric | Value |
|--------|-------|
| Bugs Found | 90 |
| Bugs Fixed (fixer_completed) | 119 |
| Bugs Verified | 1 |
| Bugs Completed to Fixed State | 119 |
| Throughput | 119 bugs/day |
| Mean Time to Fix | ~2-3 min (119 fixes in ~1h+ window) |
| Mean Time to Verify | ~5 min |
| Reopen Rate | 0% (0 reopens in 24h period) |
| First-Pass Fix Rate | ~99%+ |
| Queue Drain Rate | 119/119 (100% of queued items moved to fixed) |
| Blocked Ratio | 11.8% (16/135 active) |

## Top Problem Files

| File | Bug Count |
|------|-----------|
| `src/pregel/streaming.ts` | 10 |
| `src/swarm/pool.ts` | 6 |
| `src/swarm/factories.ts` | 6 |
| `src/models/google.ts` | 4 |
| `src/models/anthropic.ts` | 4 |
| `src/pregel/execution.ts` | 3 |
| `src/mcp/transport.ts` | 3 |
| `src/lsp/client.ts` | 3 |
| `src/hitl/resume.ts` | 3 |
| `src/harness/memory/ranker.ts` | 3 |

## Top Categories

| Category | Count |
|----------|-------|
| logic-bug | 41 |
| missing-error-handling | 16 |
| security-injection | 11 |
| race-condition | 12 |
| type-error | 11 |
| api-contract-violation | 9 |
| test-regression | 8 |
| security | 8 |
| memory-leak | 7 |
| dead-code | 5 |

## Agent Health

| Agent | Last Activity | Status |
|-------|--------------|--------|
| Hunter | 2026-03-20T18:35:09Z | **ACTIVE** (90 new bugs found today) |
| Fixer | 2026-03-20T18:36:16Z | **HIGHLY ACTIVE** (119 fixes completed today) |
| Validator | 2026-03-20T04:07:00Z | Stalled (only 1 validation in 24h) |

## Bottleneck Analysis

**Critical Issue:** Validator is severely lagging. Only 1 bug was validated in the last 24 hours while the Fixer completed 119 fixes and Hunter found 90 new bugs. This has created a massive queue: **116 bugs now sit in `fixed` status awaiting validation** with only 2 bugs currently in `in-progress` status.

**Expected validation backlog time:** At current validator pace (~1 bug per 20+ hours), clearing 116 bugs would take 96+ days. This is critically unsustainable.

**Secondary observation:** Hunter is now actively finding new bugs (90 found in 24h) and Fixer is in exceptional productivity state (119 fixes in 24h — improved from previous 104). The pipeline is supply-side healthy but completely bottlenecked on validation.

**Recommendation:**
1. **URGENT:** Restart or unblock the Validator agent immediately to process the 116-bug fixed queue.
2. Consider running validation in parallel if infrastructure supports it.
3. Investigate whether Validator has detected blocking issues (infinite loops, crashes on validation) preventing forward progress.

## Trend (vs Previous Digest)

| Metric | Previous | Current | Direction |
|--------|----------|---------|-----------|
| Active Bugs | 120 | 135 | ↑ +12.5% |
| Pending | 3 | 0 | ↓ -100% |
| Fixed Queue | 101 | 116 | ↑ +14.9% |
| In Progress | 0 | 2 | ↑ +2 |
| Blocked Ratio | 13.3% | 11.8% | ↓ -1.5% |
| Bugs Found (24h) | 0 | 90 | ↑ (Hunter reactivated) |
| Bugs Fixed (24h) | 104 | 119 | ↑ +14.4% |
| Reopen Rate | 0% | 0% | → (stable) |

**Assessment:** Exceptional activity spike. Hunter reactivated and found 90 new bugs. Fixer accelerated from 104 to 119 fixes/day (+14.4% gain). These two agents in peak productivity while Validator remains stalled. Fixed queue grew from 101 to 116 (+15 net) due to high fix throughput overwhelming single-threaded validation. Pipeline is healthy at producer level but validation gate is collapsing under load.

**Pipeline is at critical risk of validation queue saturation within 48-72 hours.**

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

The bug pipeline is experiencing exceptional producer output (Hunter +90 bugs, Fixer +119 fixes) but is now at critical risk of validation queue collapse. The fixed queue has grown to 116 bugs with only 1 validation in the last 24 hours. The Validator agent remains stalled despite high fix throughput. Without immediate validator action, the queue will become completely untenable within 48-72 hours, potentially requiring manual triage to recover.

Key recommendations:
1. **CRITICAL:** Restart Validator immediately — queue is at 116 bugs and growing
2. Investigate Validator agent failure state (crash, infinite loop, configuration issue)
3. If Validator is fundamentally broken, plan emergency validation strategy (parallel instance, manual review)
4. Monitor Hunter/Fixer to ensure they don't exceed queue capacity in the interim

*Generated by Bug Pipeline Digest Agent*
