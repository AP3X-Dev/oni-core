# Branch Map — Cycle 317

**Generated:** 2026-03-21T18:05:17Z
**Main HEAD:** 8dd12dc
**Total Branches:** 3 bugfix

| Branch | Status | Behind Main | Conflicts | Last Commit | Notes |
|---|---|---|---|---|---|
| bugfix/BUG-0343 | blocked | 66 | 0 | 2026-03-21 | `src/harness/safety-gate.ts` — clearTimeout fix correct but branch has 7-file scope contamination (redis/index.ts, checkpointers/redis.ts, pool.ts, .claude/ docs); reopen_count=3; auto-blocked; human must cherry-pick safety-gate.ts line only (commit ddec8f5) |
| bugfix/BUG-0356 | blocked | 71 | 0 | 2026-03-21 | `packages/stores/src/postgres/index.ts` — auto-blocked after 3 failed attempts; branch has out-of-scope regressions; human must cherry-pick single postgres .catch() line (commit 28a4811) |
| bugfix/BUG-0359 | blocked | 71 | 0 | 2026-03-21 | `src/harness/loop/index.ts` — off-by-one turns-remaining fix; blocked (reopen_count=3); human intervention required (commit 27d8480) |

## Active Worktrees

No active agent worktrees.

## Non-Bugfix Branches (out of scope — not deleted per policy)

| Branch | Notes |
|---|---|
| fix/bug-0257-a2a-security-headers | old fix branch, not managed |
| fix/bug-0284-a2a-auth-expired-error | old fix branch, not managed |
| fix/bug-0285-context-prompt-injection | old fix branch, not managed |
| temp-return-main | contains BUG-0357 work (already merged); non-bugfix, not deleted |

## Status Changes Since C316

BUG-0451 merged and branch deleted (merge commit 8dd12dc). Now 3 bugfix branches remain (down from 4). All 3 are blocked.

Behind-main counts increased by 3 vs C316 due to: (1) C316 git-manager commit, (2) Cycle 316 BRANCH_MAP commit, (3) BUG-0451 merge commit.
- BUG-0343: 63→66
- BUG-0356/0359: 68→71

## GC Note

GC executed Cycle 306 and Cycle 312. Next GC: Cycle 318 (this cycle is 317 — GC will execute next cycle).

## File Overlap Summary (Cycle 317)

No code overlaps — all bugfix branches touch distinct source files:
- `src/harness/safety-gate.ts` (BUG-0343)
- `packages/stores/src/postgres/index.ts` (BUG-0356)
- `src/harness/loop/index.ts` (BUG-0359)

## Cumulative Deletions

~229 total branches deleted since Git Manager began (0 deletions this cycle; BUG-0451 branch removed post-merge, not counted as a deletion).
