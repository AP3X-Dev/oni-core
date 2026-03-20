# Bug Pipeline Daily Digest

**Generated:** 2026-03-20T11:31:00Z
**Period:** Last 24 hours

---

## Pipeline Snapshot

| Metric | Value |
|--------|-------|
| Active Bugs | 49 |
| Pending | 0 |
| In Progress | 0 |
| Fixed (awaiting validation) | 33 |
| Reopened | 0 |
| Blocked | 16 |

## Severity Breakdown

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 16 |
| Medium | 30 |
| Low | 2 |

## 24h Activity

| Metric | Value |
|--------|-------|
| Bugs Found | 0 |
| Bugs Fixed | 0 |
| Bugs Verified | 0 |
| Throughput | 0 bugs/day |
| Mean Time to Fix | N/A |
| Mean Time to Verify | N/A |
| Reopen Rate | 25.0% (6/24 archived bugs have reopen_count > 0) |
| First-Pass Fix Rate | 75.0% |
| Queue Drain Rate | N/A (0 found) |
| Blocked Ratio | 32.7% |

## Top Problem Files

| File | Bug Count |
|------|-----------|
| `src/swarm/pool.ts` | 5 |
| `src/harness/memory/ranker.ts` | 3 |
| `src/swarm/agent-node.ts` | 2 |
| `packages/a2a/src/server/index.ts` | 2 |
| `src/models/google.ts` | 2 |

## Top Categories

| Category | Count |
|----------|-------|
| security-injection | 10 |
| logic-bug | 9 |
| test-regression | 8 |
| missing-error-handling | 5 |
| type-error | 4 |

## Agent Health

| Agent | Last Activity | Status |
|-------|--------------|--------|
| Hunter | 2026-03-20T03:22:00Z | active |
| Fixer | 2026-03-20T10:16:26Z | active |
| Validator | 2026-03-20T04:07:00Z | active |

## Bottleneck Analysis

**Validator is the critical bottleneck:** 33 bugs are fixed and awaiting validation with 0 currently in-validation. The Validator last ran over 7 hours ago (04:07Z). The fixed queue is massive and not draining. **Recommendation:** Urgently trigger Validator passes to clear the backlog.

**Blocked ratio at 32.7%** (up from 28.0%) — 16 of 49 active bugs are blocked. At least 8 appear to be false positives (already fixed on main) needing Hunter re-evaluation or human triage. A bulk false-positive sweep would significantly reduce noise.

**Pipeline stalled** — 0 bugs found, fixed, or verified in the last 24h. All agents appear idle since their last recorded timestamps. The pipeline needs manual intervention to resume.

## Trend (vs Previous Digest)

| Metric | Yesterday | Today | Direction |
|--------|-----------|-------|-----------|
| Active Bugs | 50 | 49 | ↓ |
| Throughput | 0 | 0 | → |
| Reopen Rate | 25.0% | 25.0% | → |
| Blocked Ratio | 28.0% | 32.7% | ↑ |

Active bug count down by 1 (meta counter correction). Blocked ratio increased from 28% to 32.7% — 2 additional bugs moved to blocked status. `src/swarm/pool.ts` remains the top problem file across multiple cycles — this module needs structural attention. Pipeline remains fully stalled with zero throughput for a second consecutive cycle.

## Blocked — Needs Human Attention

- **BUG-0191** (`low` / `dead-code`) — `src/config/types.ts:76`: `plugins?: string[]` declared but unused. Decision needed: remove field or implement plugins.
- **BUG-0205** (`critical` / `security-injection`) — `packages/tools/src/code-execution/node-eval.ts:57`: `node_eval` executes LLM code unsandboxed. Auto-blocked after 3 attempts. Needs isolated-vm or container sandboxing.
- **BUG-0235** (`high` / `test-regression`) — `src/errors.ts:44`: Fixer reports already fixed on main. Needs Hunter re-evaluation.
- **BUG-0236** (`high` / `test-regression`) — `src/checkpointers/redis.ts:52`: Fixer reports false positive — no `eval()` call exists.
- **BUG-0244** (`medium` / `security-injection`) — `src/cli/build.ts:41`: Fixer reports false positive — `shell: true` already removed.
- **BUG-0246** (`high` / `race-condition`) — `src/guardrails/budget.ts:51`: Auto-blocked after 3 attempts. `record()` is synchronous — race may not apply.
- **BUG-0250** (`medium` / `memory-leak`) — `src/harness/loop/inference.ts:156`: Fixer reports false positive — timer handle already stored.
- **BUG-0253** (`medium` / `logic-bug`) — `src/swarm/self-improvement/experiment-log.ts:57`: Fix applied but status stuck at blocked.
- **BUG-0259** (`medium` / `logic-bug`) — `src/harness/memory/ranker.ts:41`: Fixer reports false positive — recencyScore already 0.
- **BUG-0260** (`medium` / `logic-bug`) — `src/harness/memory/ranker.ts:94`: Fixer reports false positive — warning already logged.
- **BUG-0262** (`medium` / `missing-error-handling`) — `packages/tools/src/web-search/brave.ts:45`: Fixer reports false positive — try-catch present.
- **BUG-0268** (`medium` / `missing-error-handling`) — `src/harness/loop/index.ts:55`: Fix applied but status stuck at blocked.
- **BUG-0275** (`high` / `api-contract-violation`) — `src/models/openrouter.ts:472`: Fixer reports false positive — already fixed.
- **BUG-0277** (`high` / `missing-error-handling`) — `src/swarm/pool.ts:209`: Fixer reports false positive — try-catch already present.
- **BUG-0278** (`high` / `type-error`) — `src/checkpointers/redis.ts:180`: Validation added but status stuck at blocked.
- **BUG-0286** (`medium` / `security-config`) — `src/models/google.ts:383`: Fixer reports false positive — no raw content logging.

---

*Generated by Bug Pipeline Digest Agent*
