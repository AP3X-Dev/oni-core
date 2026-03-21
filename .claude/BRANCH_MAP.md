# Branch Map — Cycle 267

**Generated:** 2026-03-21T14:20:00Z
**Main HEAD:** 3d30b6b
**Total Branches:** 4 bugfix

| Branch | Status | Behind Main | Conflicts | Last Commit | Notes |
|---|---|---|---|---|---|
| bugfix/BUG-0343 | in-validation | 8 | 0 | 2026-03-21 | `src/harness/safety-gate.ts` — clearTimeout in catch block; in-validation per tracker; reopen_count=2; validator_notes reference wrong branch name (BUG-0343-0344) but bugfix/BUG-0343 exists |
| bugfix/BUG-0356 | blocked | 13 | 0 | 2026-03-21 | `packages/stores/src/postgres/index.ts` — auto-blocked after 3 failed attempts; branch has out-of-scope regressions; human must cherry-pick single postgres line |
| bugfix/BUG-0359 | blocked | 13 | 0 | 2026-03-21 | `src/harness/loop/index.ts` — off-by-one turns-remaining fix; blocked (reopen_count=3); human intervention required |
| bugfix/BUG-0420 | fixed | 0 | 0 | 2026-03-21 | `src/coordination/pubsub.ts` — REBASED C267 onto 3d30b6b; tip 84ab4f8; VALIDATOR-READY |

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

No conflict branches this cycle. All 4 remaining bugfix branches are conflict-free via `git merge-tree`.

## Status Changes Since C266

| Branch | Prev Status | C267 Status | Reason |
|---|---|---|---|
| bugfix/BUG-0420 | fixed (1 behind, tip 03ad971) | fixed (REBASED C267) | Rebased onto main HEAD 3d30b6b; tip 84ab4f8; 0 behind; VALIDATOR-READY |

## File Overlap Summary (Cycle 267)

No overlaps — all 4 remaining bugfix branches touch distinct files:
- `src/harness/safety-gate.ts` (BUG-0343)
- `packages/stores/src/postgres/index.ts` (BUG-0356)
- `src/harness/loop/index.ts` (BUG-0359)
- `src/coordination/pubsub.ts` (BUG-0420)

## Cumulative Deletions

~229 total branches deleted since Git Manager began (0 deletions this cycle).
