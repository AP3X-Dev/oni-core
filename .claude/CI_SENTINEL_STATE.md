# CI Sentinel State

> Persistent state for the CI Sentinel agent. Updated each cycle.

---

## Current Status

| Key | Value |
|---|---|
| **Last Run** | `2026-03-21T12:51:00Z` (Cycle 79 — BUILD GREEN. Tests: 6 failed / 1437 passed / 2 skipped across 3 failed suites. Known failures: BUG-0312 (2), BUG-0363 (3), BUG-0456 (1). 264 test files ran. 10 untracked TestGen files all passed (43 tests). 0 new regressions. 0 new bugs filed. 0 escalations filed.) |
| **Last Result** | `test-failures` |
| **Branch** | `main` |
| **Build Status** | `GREEN` |
| **Test Status** | `FAILED` |
| **Tests Run** | `1445` |
| **Tests Passed** | `1437` |
| **Tests Failed** | `6` |
| **Tests Skipped** | `2` |
| **Suites Failed** | `3` |
| **Bugs Filed This Cycle** | `0` |
| **Escalations Filed This Cycle** | `0` |
| **Consecutive Greens** | `0` |
| **Consecutive Failures** | `7` |

---

## Known Failing Tests (Current)

### BUG-0363 — skill-loader-content-xml-escape.test.ts (3 tests)
- Fix exists on branch `bugfix/BUG-0363`, not yet merged to main
- Tests correctly fail because the fix hasn't landed on main
- Not a new regression — expected state while BUG-0363 awaits validation/merge

### BUG-0312 — pubsub-snapshot-during-publish.test.ts (2 tests)
- Fix exists on branch `bugfix/BUG-0312`, not yet merged to main
- Status in tracker: `fixed` — awaiting validator pickup
- Tests: `"a subscriber added during delivery does not receive the triggering event"`, `"new pattern subscription added during delivery does not receive current event"`
- Root cause: `PubSub.publish()` does not snapshot the subscriber Map or handler Sets before iterating

### BUG-0456 — hooks-bash-bypass-extended.test.ts (1 test)
- Test: `"blocks chmod 777 /etc/shadow"`
- Known failure since Cycle 71

---

## Known Build Errors (Current)

None — build is GREEN as of Cycle 73.

---

## Recently Resolved

### ~~BUG-0436~~ — RESOLVED Cycle 75
- Was: `agent-node-context-privilege-leak.test.ts` — 1 test: `"__-prefixed keys returned by agent skeleton do not appear in the output context"`
- Resolved: test now passes on main as of Cycle 75 (source files modified on main)

### ~~BUG-0457 (agent-loop-turns-remaining)~~ — RESOLVED Cycle 75
- Was: `agent-loop-turns-remaining.test.ts` — 3 tests failing: `"reports 0 remaining turns on the final turn"`, `"reports maxTurns-1 remaining turns on the first turn"`, `"reports 0 remaining on the last of multiple turns"`
- Resolved: all 3 tests now pass on main as of Cycle 75

### ~~BUG-0455~~ — RESOLVED Cycle 73
- Was: `timeoutHandle` TS2304 scope error in `src/harness/safety-gate.ts` + 2 test failures
- Resolved: `src/harness/loop/tools.ts` was modified on main; build now passes; harness-safety tests now pass
- ESC-014 was filed in Cycle 72

### ~~BUG-0454~~ — RESOLVED Cycle 73
- Was: `"subgraph checkpoints are isolated from parent"` test failing in checkpoint-namespace.test.ts
- Resolved: test now passes — BUG-0453/BUG-0454 merges took effect per Git Manager Cycle 327

---

## Cooldown — Known Failures (Human Intervention Required)

| Bug ID | Description | First Seen | Cycles |
|---|---|---|---|
| ~~BUG-0235~~ | Resolved — `errors.test.ts` now passes | pre-cycle-1 | 36+ — now resolved |
| ~~BUG-0236~~ | Resolved — `redis-checkpointer.test.ts` now passes | pre-cycle-1 | 36+ — now resolved |
| ~~BUG-0293~~ | Resolved — `harness-compactor.test.ts` now passes | `2026-03-20T02:35:00Z` | 16 — now resolved |
| ~~BUG-0451~~ | Resolved — build error changed from TS2393 to TS2304 (Cycle 72), then build fully cleared (Cycle 73) | Cycle 43 | resolved |
| ~~BUG-0454~~ | Resolved Cycle 73 — checkpoint-namespace test now passes | Cycle 71 | resolved |
| ~~BUG-0455~~ | Resolved Cycle 73 — build green, harness-safety tests pass | Cycle 68 | resolved |
| BUG-0363 | `skill-loader-content-xml-escape.test.ts` — 3 tests failing, fix on `bugfix/BUG-0363` | `2026-03-21T22:45:00Z` | 9 |
| BUG-0312 | `pubsub-snapshot-during-publish.test.ts` — 2 tests failing, fix on `bugfix/BUG-0312` | Cycle 13+ | 10 |
| BUG-0456 | `hooks-bash-bypass-extended.test.ts` — 1 test failing | Cycle 71 | 5 |

---

## Run History (Last 10)

| Timestamp | Result | Tests Run | Failed | Suites Failed | Build | Bugs Filed | Escalations |
|---|---|---|---|---|---|---|---|
| `2026-03-21T12:51:00Z` | `test-failures` | 1445 | 6 | 3 | GREEN | 0 | 0 |
| `2026-03-21T12:46:00Z` | `test-failures` | 1445 | 6 | 3 | GREEN | 0 | 0 |
| `2026-03-21T12:31:27Z` | `test-failures` | 1445 | 6 | 3 | GREEN | 0 | 0 |
| `2026-03-21T20:22:00Z` | `test-failures` | 1445 | 6 | 3 | GREEN | 0 | 0 |
| `2026-03-21T19:12:12Z` | `test-failures` | 1445 | 6 | 3 | GREEN | 0 | 0 |
| `2026-03-22T12:01:15Z` | `test-failures` | 1445 | 10 | 5 | GREEN | 0 | 0 |
| `2026-03-21T18:52:00Z` | `test-failures` | 1445 | 10 | 5 | GREEN | 0 | 0 |
| `2026-03-22T18:15:00Z` | `build-failure+test-failures` | 1445 | 14 | 8 | BROKEN | 0 | 1 |
| `2026-03-22T18:00:00Z` | `build-failure` | 0 | 0 | 0 | BROKEN | 0 | 0 |
| `2026-03-22T16:15:00Z` | `build-failure` | 0 | 0 | 0 | BROKEN | 0 | 0 |
