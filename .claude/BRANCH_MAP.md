# Branch Map — Cycle 325

**Generated:** 2026-03-21T18:52:00Z
**Main HEAD:** 46988cb
**Total Branches:** 2 bugfix (2 in-validation, 0 deleted this cycle)

| Branch | Status | Classification | Notes |
|---|---|---|---|
| bugfix/BUG-0453 | in-validation | Active — fix committed, awaiting Validator | 1 commit ahead of main (d8466bf). Fix: use crypto.randomUUID() in src/testing/index.ts. 3 commits behind main. No merge conflicts. CI confirms tests passing. |
| bugfix/BUG-0454 | in-validation | Active — fix committed, CI still failing | 1 commit ahead of main (b0306ca). Fix: swap namespace prefix order in src/graph.ts + src/pregel/streaming.ts. 2 commits behind main. No merge conflicts. CI Sentinel Cycle 71 still shows test failing. |

## Active Worktrees

- bugfix/BUG-0453 — 1 commit ahead, src/testing/index.ts modified. 3 commits behind main. Merge clean (no src conflicts). Status: in-validation.
- bugfix/BUG-0454 — 1 commit ahead, src/graph.ts + src/pregel/streaming.ts modified. 2 commits behind main. Merge clean (no src conflicts). Status: in-validation. CI test still failing.

## Non-Bugfix Branches (out of scope)

None.

## Status Changes Since C324

- bugfix/BUG-0453: Tracker status updated to `in-validation`. Otherwise unchanged.
- bugfix/BUG-0454: Tracker status updated to `in-validation`. Otherwise unchanged.

## GC Note

Next GC scheduled at Cycle 330 (not this cycle).

## File Overlap Summary (Cycle 325)

- bugfix/BUG-0453: src/testing/index.ts
- bugfix/BUG-0454: src/graph.ts, src/pregel/streaming.ts
- No overlap between the two branches.

## Cumulative Deletions

~233 total branches deleted since Git Manager began (0 deletions this cycle).
