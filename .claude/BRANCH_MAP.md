# Branch Map — Cycle 283

**Generated:** 2026-03-21T15:15:34Z
**Main HEAD:** fad2091
**Total Branches:** 3 bugfix

| Branch | Status | Behind Main | Conflicts | Last Commit | Notes |
|---|---|---|---|---|---|
| bugfix/BUG-0343 | blocked | 27 | 0 | 2026-03-21 | `src/harness/safety-gate.ts` — clearTimeout fix correct but branch has 7-file scope contamination (redis/index.ts, checkpointers/redis.ts, pool.ts, .claude/ docs); reopen_count=3; auto-blocked; human must cherry-pick safety-gate.ts line only (commit ddec8f5) |
| bugfix/BUG-0356 | blocked | 32 | 0 | 2026-03-21 | `packages/stores/src/postgres/index.ts` — auto-blocked after 3 failed attempts; branch has out-of-scope regressions; human must cherry-pick single postgres .catch() line (commit 28a4811) |
| bugfix/BUG-0359 | blocked | 32 | 0 | 2026-03-21 | `src/harness/loop/index.ts` — off-by-one turns-remaining fix; blocked (reopen_count=3); human intervention required (commit 27d8480) |

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

## Status Changes Since C282

No status changes. All 3 branches remain blocked (reopen_count=3 each). Behind-main counts each increased by 1 (C282 cycle chore commit added to main): BUG-0343 now 27 behind (was 26), BUG-0356/0359 now 32 behind (was 31).

## GC Note

`git gc --auto` executed at Cycle 282. Next scheduled GC at Cycle 288.

## File Overlap Summary (Cycle 283)

No overlaps — all 3 remaining bugfix branches touch distinct files:
- `src/harness/safety-gate.ts` (BUG-0343)
- `packages/stores/src/postgres/index.ts` (BUG-0356)
- `src/harness/loop/index.ts` (BUG-0359)

## Cumulative Deletions

~229 total branches deleted since Git Manager began (0 deletions this cycle).
