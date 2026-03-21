# Branch Map — Cycle 326

**Generated:** 2026-03-21T18:45:41Z
**Main HEAD:** bdd069d
**Total Branches:** 2 bugfix (2 in-validation, 0 deleted this cycle)

| Branch | Status | Classification | Notes |
|---|---|---|---|
| bugfix/BUG-0453 | in-validation | Active — fix committed, awaiting Validator | 1 commit ahead of main (d8466bf). Fix: use crypto.randomUUID() in src/testing/index.ts. 4 commits behind main. No merge conflicts. CI green (Sentinel C72 confirms no regression for BUG-0453). |
| bugfix/BUG-0454 | in-validation | Active — fix committed, CI test still failing | 1 commit ahead of main (b0306ca). Fix: swap namespace prefix order in src/graph.ts + src/pregel/streaming.ts. 3 commits behind main. No merge conflicts. CI Sentinel C72 still shows BUG-0454 test failing — do not merge until CI green. |

## Active Worktrees

- bugfix/BUG-0453 — 1 commit ahead, src/testing/index.ts modified. 4 commits behind main. Merge clean (no src conflicts). Status: in-validation.
- bugfix/BUG-0454 — 1 commit ahead, src/graph.ts + src/pregel/streaming.ts modified. 3 commits behind main. Merge clean (no src conflicts). Status: in-validation. CI test still failing.

## Non-Bugfix Branches (out of scope)

None.

## Status Changes Since C325

- bugfix/BUG-0453: Unchanged (still in-validation). Now 4 commits behind main (was 3).
- bugfix/BUG-0454: Unchanged (still in-validation). Now 3 commits behind main (was 2).

## GC Note

Next GC scheduled at Cycle 330 (not this cycle).

## File Overlap Summary (Cycle 326)

- bugfix/BUG-0453: src/testing/index.ts
- bugfix/BUG-0454: src/graph.ts, src/pregel/streaming.ts
- No overlap between the two branches.

## Cumulative Deletions

~233 total branches deleted since Git Manager began (0 deletions this cycle).
