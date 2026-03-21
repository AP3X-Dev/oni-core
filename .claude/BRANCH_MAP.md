# Branch Map — Cycle 266

**Generated:** 2026-03-21T14:10:00Z
**Main HEAD:** 52c8431
**Total Branches:** 4 bugfix

| Branch | Status | Behind Main | Conflicts | Last Commit | Notes |
|---|---|---|---|---|---|
| bugfix/BUG-0343 | in-progress | 7 | 0 | 2026-03-21 | `src/harness/safety-gate.ts` — clearTimeout in catch block fix; tracker entry inconsistency (in-progress vs meta=0) |
| bugfix/BUG-0356 | blocked | 12 | 0 | 2026-03-21 | `packages/stores/src/postgres/index.ts` — add .catch() to void client.query(); blocked; human intervention required |
| bugfix/BUG-0359 | blocked | 12 | 0 | 2026-03-21 | `src/harness/loop/index.ts` — off-by-one turns-remaining fix; blocked; human intervention required |
| bugfix/BUG-0420 | fixed | 0 | 0 | 2026-03-21 | `src/coordination/pubsub.ts` — REBASED C266 onto 52c8431; tip 03ad971; VALIDATOR-READY |

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

## Status Changes Since C265

| Branch | Prev Status | C266 Status | Reason |
|---|---|---|---|
| bugfix/BUG-0420 | fixed (4 behind, tip 010b799) | fixed (REBASED C266) | Rebased onto main HEAD 52c8431; tip 03ad971; 0 behind; VALIDATOR-READY |

## File Overlap Summary (Cycle 266)

No overlaps — all 4 remaining bugfix branches touch distinct files:
- `src/harness/safety-gate.ts` (BUG-0343)
- `packages/stores/src/postgres/index.ts` (BUG-0356)
- `src/harness/loop/index.ts` (BUG-0359)
- `src/coordination/pubsub.ts` (BUG-0420)

## Cumulative Deletions

~229 total branches deleted since Git Manager began (0 deletions this cycle).
