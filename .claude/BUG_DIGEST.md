# Bug Pipeline Daily Digest

**Generated:** 2026-03-20T09:56:14Z
**Period:** Last 24 hours

---

## Pipeline Snapshot

| Metric | Value |
|--------|-------|
| Active Bugs | 50 |
| Pending | 1 |
| In Progress | 0 |
| Fixed (awaiting validation) | 33 |
| Reopened | 0 |
| Blocked | 16 |

## Severity Breakdown

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 16 |
| Medium | 31 |
| Low | 2 |

## 24h Activity

| Metric | Value |
|--------|-------|
| Bugs Found | 45 |
| Bugs Fixed | 54 |
| Bugs Verified | 12 |
| Throughput | 12 bugs/day |
| Mean Time to Fix | ~8h |
| Mean Time to Verify | ~2h |
| Reopen Rate | 6.3% |
| First-Pass Fix Rate | 93.7% |
| Queue Drain Rate | 0.27 |
| Blocked Ratio | 32.0% |

## Top Problem Files

| File | Bug Count |
|------|-----------|
| `src/swarm/self-improvement/skill-evolver.ts` | 5 |
| `src/swarm/pool.ts` | 5 |
| `src/swarm/agent-node.ts` | 5 |
| `src/models/google.ts` | 5 |
| `src/models/anthropic.ts` | 5 |

## Top Categories

| Category | Count |
|----------|-------|
| logic-bug | 41 |
| missing-error-handling | 23 |
| security-injection | 14 |
| race-condition | 11 |
| security | 10 |

## Agent Health

| Agent | Last Activity | Status |
|-------|--------------|--------|
| Hunter | 2026-03-19T23:05:00Z | active |
| Fixer | 2026-03-20T09:40:46Z | active |
| Validator | 2026-03-20T04:07:00Z | active |

## Bottleneck Analysis

**Validator is the critical bottleneck:** 33 bugs are fixed and awaiting validation with 0 currently in-validation. The Validator's last pass was over 5 hours ago (04:07Z). The Fixer has been highly productive (54 fixes in 24h) but the fixed queue is not draining. **Recommendation:** Urgently trigger Validator passes to clear the massive fixed queue.

**Queue Drain Rate at 0.27** — the pipeline is falling far behind. 45 bugs found vs only 12 verified. The Validator must increase throughput significantly to prevent indefinite backlog growth.

**Blocked ratio at 32.0%** — 16 of 50 active bugs are blocked. At least 10 are false positives (already fixed on main) needing Hunter re-evaluation or human triage. Consider a bulk false-positive sweep to reduce noise.

## Trend (vs Previous Digest)

| Metric | Yesterday | Today | Direction |
|--------|-----------|-------|-----------|
| Active Bugs | 48 | 50 | ↑ |
| Throughput | 12 | 12 | → |
| Reopen Rate | 0% | 6.3% | ↑ |
| Blocked Ratio | 33.3% | 32.0% | ↓ |

Active bug count increased by 2 (new bugs outpacing verification). Throughput stable at 12/day — Validator capacity unchanged. Reopen rate rose to 6.3% (6 of 95 archived bugs had reopens). Blocked ratio slightly improved. `src/swarm/pool.ts` and `src/swarm/self-improvement/skill-evolver.ts` remain persistent top problem files — these modules need structural attention. Security bugs continue to dominate new findings following recent security scans.

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
- **BUG-0268** (`medium` / `missing-error-handling`) — `src/harness/loop/index.ts:55`: Fix applied but status stuck at blocked.
- **BUG-0275** (`high` / `api-contract-violation`) — `src/models/openrouter.ts:472`: False positive — already fixed.
- **BUG-0277** (`high` / `missing-error-handling`) — `src/swarm/pool.ts:209`: False positive — try-catch present.
- **BUG-0278** (`high` / `type-error`) — `src/checkpointers/redis.ts:180`: Validation added but status stuck at blocked.
- **BUG-0286** (`medium` / `security-config`) — `src/models/google.ts:383`: False positive — no raw content logging.

---

*Generated by Bug Pipeline Digest Agent*
