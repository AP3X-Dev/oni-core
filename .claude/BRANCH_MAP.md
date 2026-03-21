# Branch Map — Cycle 264

**Generated:** 2026-03-21T13:41:47Z
**Main HEAD:** d31587e
**Total Branches:** 5 bugfix (BUG-0457 merged to main post-C263 as d31587e, branch auto-deleted)

| Branch | Status | Behind Main | Conflicts | Last Commit | Notes |
|---|---|---|---|---|---|
| bugfix/BUG-0343 | in-progress | 2 | 0 | 2026-03-21 | `src/harness/safety-gate.ts` — clearTimeout in catch block fix; 2 behind main |
| bugfix/BUG-0355 | fixed | 0 | 0 | 2026-03-21 | `packages/stores/src/redis/index.ts` — REBASED C264 onto main d31587e; tip 3881ae1; VALIDATOR-READY |
| bugfix/BUG-0356 | blocked | 7 | 0 | 2026-03-21 | `packages/stores/src/postgres/index.ts` — add .catch() to void client.query(); blocked |
| bugfix/BUG-0359 | blocked | 7 | 0 | 2026-03-21 | `src/harness/loop/index.ts` — off-by-one turns-remaining fix; blocked |
| bugfix/BUG-0420 | fixed | 7 | 0 | 2026-03-21 | `src/coordination/pubsub.ts` — leak-warning + empty-Set cleanup; rebase recommended next cycle |

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

No conflict branches this cycle. All 5 bugfix branches are conflict-free via `git merge-tree`.

## Status Change Since C263/C264

| Branch | Prev Status | C264 Status | Reason |
|---|---|---|---|
| bugfix/BUG-0457 | fixed (rebased C263) | MERGED | Merged to main (commit d31587e) post-C263; branch auto-deleted |
| bugfix/BUG-0355 | fixed (7 behind) | fixed (rebased C264) | Rebased onto main HEAD d31587e; tip 3881ae1; 0 behind |
| worktree-agent-a8cdef80 | merged (sched delete C264) | DELETED | Force-deleted (merged to HEAD, no active worktree) |
| worktree-agent-aed25a0e | merged (sched delete C264) | DELETED | Force-deleted (merged to HEAD, no active worktree) |
| worktree-agent-af149a67 | merged (sched delete C264) | DELETED | Force-deleted (merged to HEAD, no active worktree) |
| worktree-agent-a4919386 | 1 unmerged commit | DELETED | BUG-0355 duplicate fix absorbed by bugfix/BUG-0355; no active worktree |

## File Overlap Summary (Cycle 264)

No overlaps — all 5 bugfix branches touch distinct files:
- `src/harness/safety-gate.ts` (BUG-0343)
- `packages/stores/src/redis/index.ts` (BUG-0355)
- `packages/stores/src/postgres/index.ts` (BUG-0356)
- `src/harness/loop/index.ts` (BUG-0359)
- `src/coordination/pubsub.ts` (BUG-0420)

## Cumulative Deletions

~229 total branches deleted since Git Manager began (4 deletions this cycle: worktree-agent-a8cdef80/aed25a0e/af149a67/a4919386).
