# Branch Map — Cycle 265 (corrected)

**Generated:** 2026-03-21T14:05:00Z
**Main HEAD:** 24f5db9
**Total Branches:** 4 bugfix

| Branch | Status | Behind Main | Conflicts | Last Commit | Notes |
|---|---|---|---|---|---|
| bugfix/BUG-0343 | in-progress | 4 | 0 | 2026-03-21 | `src/harness/safety-gate.ts` — clearTimeout in catch block fix; tracker entry inconsistency (in-progress vs meta=0) |
| bugfix/BUG-0356 | blocked | 9 | 0 | 2026-03-21 | `packages/stores/src/postgres/index.ts` — add .catch() to void client.query(); blocked; human intervention required |
| bugfix/BUG-0359 | blocked | 9 | 0 | 2026-03-21 | `src/harness/loop/index.ts` — off-by-one turns-remaining fix; blocked; human intervention required |
| bugfix/BUG-0420 | fixed | 1 | 0 | 2026-03-21 | `src/coordination/pubsub.ts` — REBASED C265 onto 1d38d33; tip 010b799; VALIDATOR-READY |

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

## Status Change Since C264/C265

| Branch | Prev Status | C265 Status | Reason |
|---|---|---|---|
| bugfix/BUG-0355 | fixed (rebased C264, 1 behind) | MERGED | Merged to main as bcd0302 between C264 and C265; branch auto-deleted |
| bugfix/BUG-0420 | fixed (8 behind, rebase recommended) | fixed (REBASED C265) | Rebased onto main HEAD 1d38d33; tip 010b799; 0 behind (now 1 behind after C265 commit); VALIDATOR-READY |
| bugfix/BUG-0378 | in-validation (C264 phantom) | ABSENT | Branch not found locally; was stale remote ref only |

## File Overlap Summary (Cycle 265)

No overlaps — all 4 remaining bugfix branches touch distinct files:
- `src/harness/safety-gate.ts` (BUG-0343)
- `packages/stores/src/postgres/index.ts` (BUG-0356)
- `src/harness/loop/index.ts` (BUG-0359)
- `src/coordination/pubsub.ts` (BUG-0420)

## Cumulative Deletions

~229 total branches deleted since Git Manager began (0 deletions this cycle; BUG-0355 merged+auto-deleted by validator/fixer agent).
