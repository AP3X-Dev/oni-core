# Branch Map — Cycle 263

**Generated:** 2026-03-21T13:36:38Z
**Main HEAD:** 3f05782
**Total Branches:** 5 bugfix (down from 6 at C261; BUG-0366+BUG-0404 merged to main)

| Branch | Status | Behind Main | Conflicts | Last Commit | Notes |
|---|---|---|---|---|---|
| bugfix/BUG-0355 | in-progress | 1 | 0 | 2026-03-21 | `packages/stores/src/redis/index.ts` — 0 conflicts; add .catch() to 3 zrem() calls only |
| bugfix/BUG-0356 | in-progress | 1 | 0 | 2026-03-21 | `packages/stores/src/postgres/index.ts` — 0 conflicts; add .catch() to void client.query() |
| bugfix/BUG-0359 | fixed | 1 | 0 | 2026-03-21 | `src/harness/loop/index.ts` — clean; fix only line 156 (maxTurns-turn-1 → maxTurns-turn) |
| bugfix/BUG-0420 | fixed | 1 | 0 | 2026-03-21 | `src/coordination/pubsub.ts` — clean; leak-warning + empty-Set cleanup fix |
| bugfix/BUG-0457 | fixed | 0 | 0 | 2026-03-21 | `src/checkpointers/redis.ts` — REBASED C263 onto main 3f05782; tip 2c5f74d; VALIDATOR-READY PRIORITY #1 |

## Active Worktrees

No active agent worktrees.

## Non-Bugfix Branches (out of scope — not deleted per policy)

| Branch | Notes |
|---|---|
| fix/bug-0257-a2a-security-headers | 852 behind main — old fix branch, not managed |
| fix/bug-0284-a2a-auth-expired-error | 852 behind main — old fix branch, not managed |
| fix/bug-0285-context-prompt-injection | 852 behind main — old fix branch, not managed |
| temp-return-main | 46 behind main — contains BUG-0357 work (already merged); non-bugfix, not deleted |
| worktree-agent-a4919386 | 852 behind main — not fully merged; non-bugfix, not deleted per policy |
| worktree-agent-a8cdef80 | merged to HEAD — cap limit reached C263; schedule deletion next cycle |
| worktree-agent-aed25a0e | merged to HEAD — cap limit reached C263; schedule deletion next cycle |
| worktree-agent-af149a67 | merged to HEAD — cap limit reached C263; schedule deletion next cycle |

## Conflict Branches (0)

No conflict branches this cycle. All 5 bugfix branches are conflict-free via `git merge-tree`.

## Status Change Since C261/C262

| Branch | Prev Status | C263 Status | Reason |
|---|---|---|---|
| bugfix/BUG-0366 | fixed | MERGED | Merged to main (commit 2197ce0) |
| bugfix/BUG-0404 | fixed | MERGED | Merged to main (commit 3f05782) |
| bugfix/BUG-0457 | fixed | fixed (rebased) | Rebased onto main HEAD 3f05782; tip 2c5f74d |
| worktree-agent-a0ae4363 | merged | DELETED | Force-deleted (merged to HEAD, no active worktree) |
| worktree-agent-a222e12b | merged | DELETED | Force-deleted (merged to HEAD, no active worktree) |
| worktree-agent-a3629ccc | merged | DELETED | Force-deleted (merged to HEAD, no active worktree) |
| worktree-agent-a5e56beb | merged | DELETED | Force-deleted (merged to HEAD, no active worktree) |
| worktree-agent-a7cfb796 | merged | DELETED | Force-deleted (merged to HEAD, no active worktree) |

## File Overlap Summary (Cycle 263)

No overlaps — all 5 bugfix branches touch distinct files:
- `packages/stores/src/redis/index.ts` (BUG-0355)
- `packages/stores/src/postgres/index.ts` (BUG-0356)
- `src/harness/loop/index.ts` (BUG-0359)
- `src/coordination/pubsub.ts` (BUG-0420)
- `src/checkpointers/redis.ts` (BUG-0457)

## Cumulative Deletions

~225 total branches deleted since Git Manager began (5 deletions this cycle: worktree-agent-a0ae4363/a222e12b/a3629ccc/a5e56beb/a7cfb796).
