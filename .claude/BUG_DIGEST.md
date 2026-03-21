# Bug Pipeline Daily Digest

**Generated:** 2026-03-21T05:29:59Z
**Period:** Last 24 hours

---

## Pipeline Snapshot

| Metric | Value |
|--------|-------|
| Active Bugs | 65 |
| Pending | 1 |
| In Progress | 0 |
| Fixed (awaiting validation) | 52 |
| In Validation | 1 |
| Reopened | 2 |
| Blocked | 9 |

## 24h Activity

| Metric | Value |
|--------|-------|
| Bugs Found | 16 |
| Bugs Fixed | 60 |
| Bugs Verified | 7 |
| Throughput | 7 bugs/day |
| Mean Time to Fix | 0.5 hours |
| Mean Time to Verify | 0.9 hours |
| Reopen Rate | 3.1% |
| First-Pass Fix Rate | 96.9% |
| Queue Drain Rate | 0.44 |
| Blocked Ratio | 13.8% |

## Top Problem Files

| File | Bug Count |
|------|-----------|
| `src/swarm/agent-node.ts` | 3 |
| `packages/loaders/src/loaders/*.ts` | 5 |
| `src/checkpointers/` | 4 |
| `src/models/` | 4 |
| `src/harness/` | 5 |

## Top Categories

| Category | Count |
|----------|-------|
| memory-leak | 12 |
| missing-error-handling | 15 |
| logic-bug | 11 |
| race-condition | 8 |
| type-error | 6 |

## Agent Health

| Agent | Last Activity | Status |
|-------|--------------|--------|
| Hunter | 2026-03-20T22:45:00Z | Active |
| Fixer | 2026-03-21T06:25:00Z | Active |
| Validator | 2026-03-21T05:23:12Z | Active |

## Bottleneck Analysis

**Validator backlog continues to grow:** 52 bugs fixed and awaiting validation, with only 7 verified in the last 24h. This is a 7.4x throughput gap. The Fixer is operating at peak efficiency (60 fixes in 24h) but the Validator cannot keep pace.

**Critical metrics:**
- **Queue drain rate is 0.44** — for every bug verified, 2.3 new bugs are found or fixed. The pipeline is accumulating technical debt rapidly.
- **Blocked count increased from 7 to 9** — two additional bugs auto-blocked on reaching reopen limit 3.
- **Pending queue nearly cleared (53→1)** — Fixer successfully processed the backlog.

**Root cause:** The Validator is the hard bottleneck. With 52 bugs in fixed state and only 7/day verification rate, the queue will reach 300+ within 10 days at current velocity.

**Recommendations:**
1. **Urgent: Scale Validator capacity** — Consider parallel validation, increased frequency, or dedicated Validator fleet.
2. **Monitor BUG-0382 reopened** — PreToolUse hook fix regressed, now in-validation. This pattern (removing unrelated features while fixing core issue) has appeared 3 times recently.
3. **Investigate BUG-0386 reopened** — Auth resolver still not using ctx parameter despite signature update. Fix quality issues persist.

## Trend (vs Previous Digest)

| Metric | Previous | Current | Direction |
|--------|----------|---------|-----------|
| Active Bugs | 66 | 65 | ↓ (net verification) |
| Pending | 8 | 1 | ↓ (nearly cleared) |
| Fixed Queue | 46 | 52 | ↑ (continued growth) |
| In Validation | 0 | 1 | ↑ |
| Reopened | 0 | 2 | ↑ (quality regressions) |
| Blocked | 7 | 9 | ↑ |
| Throughput (verified/day) | 12 | 7 | ↓ (Validator slowing) |
| Bugs Found | 62 | 16 | ↓ (Hunter pace reduced) |

**Assessment:** The pipeline has shifted from balanced operation to validation-bottleneck mode. Fixer reached peak velocity (60 fixes, a 28% improvement over yesterday), but Validator throughput declined 40% (12→7 verified/day). The fixed queue grew 13% despite higher verification rate yesterday, indicating the Validator cannot sustain 46-bug backlog clearance. Pending queue clearing is positive, but the 52-bug fixed queue now represents a 4-7 day validation backlog. Reopen rate is improving (6.3%→3.1%), suggesting fix quality has stabilized — but two reopened bugs (BUG-0382, 0386) both show the same pattern of scope creep (removing unrelated features during focused bug fixes).

## Blocked — Needs Human Attention

9 bugs currently blocked:

- **BUG-0205** (critical, security-injection): `node_eval` arbitrary code execution via `new Function()` without capability sandbox. 3 reopens. Requires architectural decision on sandboxing (isolated-vm vs container).
- **BUG-0256** (medium, 4 reopens): A2AServer auth defaults to unauthenticated — fix attempts consistently miss the core logic, addressing only type exports or unrelated features.
- **BUG-0264** (medium, 3 reopens): LSP JSON-RPC message validation — all 3 fix attempts failed same 3 validation gaps (jsonrpc version, id check, result/error presence).
- **BUG-0304** (high, 3 reopens): Budget tracker doesn't validate token counts — fix branch exists but never merged to main.
- **BUG-0306** (medium, 3 reopens): onError hook missing try/catch in swarm pool — branch also removes unrelated safety guards instead of minimal 5-line fix.
- **BUG-0348** (medium): stripProtoKeys shadowing — flagged as potential false positive, Fixer marked as such.
- **BUG-0352** (medium): StateGraph edge mutation — flagged as potential false positive, marked correctly as such.
- **BUG-0370** (high): Fan-out send channel updates — by-design, not a bug. Marked correctly.
- **BUG-0371** (high): Parallel node LWW channel updates — by-design, not a bug. Marked correctly.
- **BUG-0385** (medium): Auth resolver scope parameter — flagged as false positive, code does not exist.

---

*Generated by Bug Pipeline Digest Agent*
