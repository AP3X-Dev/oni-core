# Branch Map — Cycle 316

**Generated:** 2026-03-23T00:00:00Z
**Main HEAD:** 975785b
**Total Branches:** 4 bugfix

| Branch | Status | Behind Main | Conflicts | Last Commit | Notes |
|---|---|---|---|---|---|
| bugfix/BUG-0343 | blocked | 63 | 0 | 2026-03-21 | `src/harness/safety-gate.ts` — clearTimeout fix correct but branch has 7-file scope contamination (redis/index.ts, checkpointers/redis.ts, pool.ts, .claude/ docs); reopen_count=3; auto-blocked; human must cherry-pick safety-gate.ts line only (commit ddec8f5) |
| bugfix/BUG-0356 | blocked | 68 | 0 | 2026-03-21 | `packages/stores/src/postgres/index.ts` — auto-blocked after 3 failed attempts; branch has out-of-scope regressions; human must cherry-pick single postgres .catch() line (commit 28a4811) |
| bugfix/BUG-0359 | blocked | 68 | 0 | 2026-03-21 | `src/harness/loop/index.ts` — off-by-one turns-remaining fix; blocked (reopen_count=3); human intervention required (commit 27d8480) |
| bugfix/BUG-0451 | in-validation | 2 | doc-only | 2026-03-21 | `src/swarm/graph.ts` — CRITICAL: removes duplicate dispose() (TS2393 build failure). Fix applied 2026-03-22T22:18:00Z. Merge-tree shows 2 conflict markers but ONLY in .claude/ metadata files (BRANCH_MAP.md, BUG_TRACKER.md) — src/swarm/graph.ts merges cleanly. Awaiting Validator sign-off. |

## Active Worktrees

No active agent worktrees.

## Non-Bugfix Branches (out of scope — not deleted per policy)

| Branch | Notes |
|---|---|
| fix/bug-0257-a2a-security-headers | old fix branch, not managed |
| fix/bug-0284-a2a-auth-expired-error | old fix branch, not managed |
| fix/bug-0285-context-prompt-injection | old fix branch, not managed |
| temp-return-main | contains BUG-0357 work (already merged); non-bugfix, not deleted |

## Conflict Branches (doc-only)

BUG-0451 shows 2 merge-tree conflict markers — both in .claude/ metadata files only. Source code (src/swarm/graph.ts) merges cleanly. Not a code conflict. Validator should resolve metadata conflicts manually on merge.

## Status Changes Since C315

BUG-0451 newly tracked this cycle (not in C315 branch map). Branch existed prior but first detected in C316 inventory. Status: in-validation. All 3 blocked branches unchanged.

## GC Note

GC executed Cycle 306 and Cycle 312. Next GC: Cycle 318.

## File Overlap Summary (Cycle 316)

No code overlaps — all bugfix branches touch distinct source files:
- `src/harness/safety-gate.ts` (BUG-0343)
- `packages/stores/src/postgres/index.ts` (BUG-0356)
- `src/harness/loop/index.ts` (BUG-0359)
- `src/swarm/graph.ts` (BUG-0451)

## Cumulative Deletions

~229 total branches deleted since Git Manager began (0 deletions this cycle).
