# Branch Map — Cycle 269

**Generated:** 2026-03-21T15:00:00Z
**Main HEAD:** ca572b5
**Total Branches:** 3 bugfix

| Branch | Status | Behind Main | Conflicts | Last Commit | Notes |
|---|---|---|---|---|---|
| bugfix/BUG-0343 | blocked | 12 | 0 | 2026-03-21 | `src/harness/safety-gate.ts` — clearTimeout fix correct but branch has 7-file scope contamination (redis/index.ts, checkpointers/redis.ts, pool.ts, .claude/ docs); reopen_count=3; auto-blocked; human must cherry-pick safety-gate.ts line only |
| bugfix/BUG-0356 | blocked | 17 | 0 | 2026-03-21 | `packages/stores/src/postgres/index.ts` — auto-blocked after 3 failed attempts; branch has out-of-scope regressions; human must cherry-pick single postgres line |
| bugfix/BUG-0359 | blocked | 17 | 0 | 2026-03-21 | `src/harness/loop/index.ts` — off-by-one turns-remaining fix; blocked (reopen_count=3); human intervention required |

## Active Worktrees

No active agent worktrees.

## Non-Bugfix Branches (out of scope — not deleted per policy)

| Branch | Notes |
|---|---|
| fix/bug-0257-a2a-security-headers | old fix branch, not managed |
| fix/bug-0284-a2a-auth-expired-error | old fix branch, not managed |
| fix/bug-0285-context-prompt-injection | old fix branch, not managed |
| temp-return-main | contains BUG-0357 work (already merged); non-bugfix, not deleted |

## Conflict Branches (0)

No conflict branches this cycle. All 3 remaining bugfix branches are conflict-free via `git merge-tree`.

## Status Changes Since C268

No status changes. All 3 branches remain blocked (reopen_count=3 each). Behind-main counts increased by 1 (BUG-0343: 11→12; BUG-0356: 16→17; BUG-0359: 16→17) due to Cycle 268 commit on main.

## File Overlap Summary (Cycle 269)

No overlaps — all 3 remaining bugfix branches touch distinct files:
- `src/harness/safety-gate.ts` (BUG-0343)
- `packages/stores/src/postgres/index.ts` (BUG-0356)
- `src/harness/loop/index.ts` (BUG-0359)

## Cumulative Deletions

~229 total branches deleted since Git Manager began (0 deletions this cycle).
