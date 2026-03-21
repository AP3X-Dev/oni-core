# CI Sentinel State

> Persistent state for the CI Sentinel agent. Updated each cycle.

---

## Current Status

| Key | Value |
|---|---|
| **Last Run** | `2026-03-21T20:00:00Z` (Cycle 56 — BUILD BROKEN: TS2393 duplicate dispose() in src/swarm/graph.ts lines 245+378 STILL PRESENT; ESC-013 still active; 40 consecutive build failures; no new bugs filed; tests not run. 10 untracked Hunter test files still present — cannot evaluate until build clean.) |
| **Last Result** | `build-failure` |
| **Branch** | `main` |
| **Build Status** | `BROKEN` |
| **Test Status** | `NOT_RUN` |
| **Tests Run** | `0` |
| **Tests Passed** | `0` |
| **Tests Failed** | `0` |
| **Tests Skipped** | `0` |
| **Suites Failed** | `0` |
| **Bugs Filed This Cycle** | `0` |
| **Escalations Filed This Cycle** | `0` |
| **Consecutive Greens** | `0` |
| **Consecutive Failures** | `40` |

---

## Known Failing Tests (Current)

### BUG-0363 — skill-loader-content-xml-escape.test.ts (3 tests)
- Fix exists on branch `bugfix/BUG-0363`, not yet merged to main
- Tests correctly fail because the fix hasn't landed on main
- Not a new regression — expected state while BUG-0363 awaits validation/merge

### BUG-0436 — agent-node-context-privilege-leak.test.ts (1 test) — NEW Cycle 40
- Regression: BUG-0399 fix (`bugfix/BUG-0399`) never merged to main
- `__`-prefixed keys from `result.context` not filtered on normal completion path in `src/swarm/agent-node.ts` line 169
- Test: `"__-prefixed keys returned by agent skeleton do not appear in the output context"`
- Filed as BUG-0436 (high severity, security-injection)

### BUG-0312 — pubsub-snapshot-during-publish.test.ts (2 tests)
- Fix exists on branch `bugfix/BUG-0312`, not yet merged to main
- Status in tracker: `fixed` — awaiting validator pickup
- Tests: `"a subscriber added during delivery does not receive the triggering event"`, `"new pattern subscription added during delivery does not receive current event"`
- Root cause: `PubSub.publish()` does not snapshot the subscriber Map or handler Sets before iterating
- NOTE: Previously misidentified as "BUG-0370" in CI state — corrected in Cycle 14; actual tracker entry is BUG-0312

### BUG-0401 / BUG-0402 — Ghost Suite "Cannot find module" (infrastructure, transient/worsening)
- BUG-0401 (Cycle 18): 1 ghost suite (`skill-evolver-esm-path.test.ts`)
- BUG-0402 (Cycle 19): 10+ ghost suites — mass escalation of the same pattern
- All ghost suites pass in isolation; failure is during parallel `npm test` run only
- Affected suites: `circuit-breaker-half-open-single-probe.test.ts`, `cli-toplevel-error-handling.test.ts`, `lsp-client-message-validation.test.ts`, `request-reply-atomic-resolved.test.ts`, `harness-loop-env-sanitize.test.ts`, `harness-tools-hook-args-replace.test.ts`, `swarm/experiment-log-trim.test.ts`, `swarm/registry-tomanifest-injection.test.ts`, `swarm/scaling-error-latency-regression.test.ts`, `swarm/spawn-agent-concurrent-snapshot.test.ts`, `swarm/swarmgraph-dispose.test.ts`, `swarm/tracer-event-trim.test.ts`
- Human intervention required — vitest worker pool / module resolution cache issue under high parallelism

### BUG-0382 — harness-tools-hook-args-replace.test.ts — NOTE: tests PASS in isolation
- CI state previously listed this as a cooldown failure; Cycle 19 confirms tests pass in isolation (13 tests green)
- The BUG-0382 ghost failure in Cycle 19 is due to BUG-0402 (ghost surge), not the original BUG-0382 test regression
- Original BUG-0382 fix (`bugfix/BUG-0382`) may already be merged — verify

### BUG-0391 — swarm/registry-tomanifest-injection.test.ts — NOTE: tests PASS in isolation
- Same situation as BUG-0382: passes in isolation in Cycle 19 (13-test batch)
- Ghost failure in Cycle 19 is due to BUG-0402 (ghost surge)

### BUG-0364 — harness-loop-env-sanitize.test.ts — RESOLVED
- All 5 tests now passing on main
- `sanitizeEnvValue()` fix is already committed to main (found in `src/harness/loop/index.ts` line 163)
- Previous cycles incorrectly reported this as still failing — self-corrected in Cycle 14

### BUG-0368 — pregel-nodes-snapshot-regression.test.ts (parallel timeout)
- Previously filed in Cycle 9; DID NOT reproduce in Cycles 10–19
- Monitoring for recurrence

### BUG-0369 — swarm/supervisor-routing-error.test.ts (worker pool failure)
- Previously filed in Cycle 9; DID NOT reproduce in Cycles 10–19
- Monitoring for recurrence

---

## Known Build Errors (Current)

### BUG-0451 — src/swarm/graph.ts duplicate dispose() (TS2393)
- Merge artifact: bugfix/BUG-0412 merged on top of bugfix/BUG-0327 without removing original dispose() at line 245
- Complete dispose() at line 378 handles both subgraph iteration AND broker/pubsub cleanup
- Lines 239-250 (partial dispose under `// ---- Disposal ----`) must be removed
- Filed as BUG-0451 (critical), escalated as ESC-013
- **CYCLE 43 NOTE:** Fixer marked fix_summary as "Not reproducible. Already resolved." — THIS IS INCORRECT. Cycle 43 confirmed duplicate dispose() still present at lines 245 and 378 on main. TS2393 still firing. ESC-013 remains active. Fixer must re-examine main HEAD.
- **CYCLE 44 NOTE:** Cycle 44 re-confirms duplicate dispose() still at lines 245 and 378. `tsc --noEmit` exits 2 with both TS2393 errors. Fix was NOT applied. Fixer must remove lines ~239-250 (partial dispose under `// ---- Disposal ----`). Consecutive failures now 28.
- **CYCLE 45 NOTE:** Cycle 45 re-confirms same TS2393 errors. Build BROKEN for 29 consecutive cycles. ESC-013 still active and unresolved. Fixer must delete lines 239-250 of src/swarm/graph.ts (partial dispose under `// ---- Disposal ----`).
- **CYCLE 46 NOTE:** Cycle 46 re-confirms same TS2393 errors. Build BROKEN for 30 consecutive cycles. ESC-013 still active and unresolved. BUG-0451 remains blocked with incorrect fixer_summary. Human intervention required: delete lines ~239-250 of src/swarm/graph.ts (the partial dispose() under `// ---- Disposal ----`). Retain complete dispose() at line 378.
- **CYCLE 47 NOTE:** Cycle 47 re-confirms same TS2393 errors. Build BROKEN for 31 consecutive cycles. ESC-013 still active and unresolved. Human intervention required urgently.
- **CYCLE 48 NOTE:** Cycle 48 re-confirms same TS2393 errors. Build BROKEN for 32 consecutive cycles. ESC-013 still active and unresolved. Partial dispose() at lines 245-250 confirmed still present. Human intervention required: delete lines 239-250 of src/swarm/graph.ts.
- **CYCLE 49 NOTE:** Cycle 49 re-confirms same TS2393 errors. Build BROKEN for 33 consecutive cycles. ESC-013 still active and unresolved. No fixer or human action taken. Human intervention required urgently: delete lines ~239-250 of src/swarm/graph.ts (partial dispose() under `// ---- Disposal ----`). Retain complete dispose() at line 378.
- **CYCLE 50 NOTE:** Cycle 50 re-confirms same TS2393 errors. Build BROKEN for 34 consecutive cycles. ESC-013 still active and unresolved. No fixer or human action taken. Human intervention required urgently: delete lines ~239-250 of src/swarm/graph.ts (partial dispose() under `// ---- Disposal ----`). Retain complete dispose() at line 378.
- **CYCLE 51 NOTE:** Cycle 51 re-confirms same TS2393 errors. Build BROKEN for 35 consecutive cycles. ESC-013 still active and unresolved. Partial dispose() confirmed at lines 245-250 (only clears broker/pubsub). Complete dispose() confirmed at lines 378-386 (iterates subGraphs, clears broker/pubsub). No fixer or human action taken. Human intervention required urgently: delete lines 239-250 of src/swarm/graph.ts.
- **CYCLE 52 NOTE:** Cycle 52 re-confirms same TS2393 errors. `tsc --noEmit` exits 2. Build BROKEN for 36 consecutive cycles. ESC-013 still active and unresolved. BUG-0451 remains `blocked`. Partial dispose() at lines 239-250 (under `// ---- Disposal ----`) still present on main HEAD; complete dispose() at line 378 still present. No fixer or human action taken. Human intervention required urgently: delete lines 239-250 of src/swarm/graph.ts (partial dispose() method that only clears broker/pubsub). Retain the complete dispose() at line 378.
- **CYCLE 53 NOTE:** Cycle 53 re-confirms same TS2393 errors. `tsc --noEmit` exits 2 with `src/swarm/graph.ts(245,3): error TS2393` and `src/swarm/graph.ts(378,3): error TS2393`. Build BROKEN for 37 consecutive cycles. ESC-013 still active and unresolved. BUG-0451 remains `blocked`. No fixer or human action taken. 11 untracked Hunter test files now present (up from 10). Human intervention required urgently: delete lines ~239-250 of src/swarm/graph.ts (partial dispose() under `// ---- Disposal ----`). Retain complete dispose() at line 378.
- **CYCLE 54 NOTE:** Cycle 54 re-confirms same TS2393 errors. `tsc --noEmit` exits 2 with `src/swarm/graph.ts(245,3): error TS2393` and `src/swarm/graph.ts(378,3): error TS2393`. Build BROKEN for 38 consecutive cycles. ESC-013 still active and unresolved. BUG-0451 remains `blocked`. No fixer or human action taken. 10 untracked Hunter test files present. Human intervention required urgently: delete lines ~239-250 of src/swarm/graph.ts (partial dispose() under `// ---- Disposal ----`). Retain complete dispose() at line 378.
- **CYCLE 55 NOTE:** Cycle 55 re-confirms same TS2393 errors. `tsc --noEmit` exits 2 with `src/swarm/graph.ts(245,3): error TS2393` and `src/swarm/graph.ts(378,3): error TS2393`. Build BROKEN for 39 consecutive cycles. ESC-013 still active and unresolved. BUG-0451 remains `blocked`. No fixer or human action taken. 10 untracked Hunter test files present. Human intervention required urgently: delete lines ~239-250 of src/swarm/graph.ts (partial dispose() under `// ---- Disposal ----`). Retain complete dispose() at line 378.
- **CYCLE 56 NOTE:** Cycle 56 re-confirms same TS2393 errors. `tsc --noEmit` exits 2 with `src/swarm/graph.ts(245,3): error TS2393` and `src/swarm/graph.ts(378,3): error TS2393`. Build BROKEN for 40 consecutive cycles. ESC-013 still active and unresolved. BUG-0451 remains `blocked`. No fixer or human action taken. 10 untracked Hunter test files present. Human intervention required urgently: delete lines ~239-250 of src/swarm/graph.ts (partial dispose() under `// ---- Disposal ----`). Retain complete dispose() at line 378.
- Build is BROKEN — tests cannot run

---

## Cooldown — Known Failures (Human Intervention Required)

| Bug ID | Description | First Seen | Cycles |
|---|---|---|---|
| ~~BUG-0235~~ | Resolved — `errors.test.ts` now passes | pre-cycle-1 | 36+ — now resolved |
| ~~BUG-0236~~ | Resolved — `redis-checkpointer.test.ts` now passes | pre-cycle-1 | 36+ — now resolved |
| ~~BUG-0293~~ | Resolved — `harness-compactor.test.ts` now passes | `2026-03-20T02:35:00Z` | 16 — now resolved |
| ~~BUG-0367~~ (prev) | Resolved — `nodesSnapshot` undefined in `src/pregel/streaming.ts` | `2026-03-21T20:01:00Z` | 3 — now resolved (committed) |
| ~~BUG-0367~~ (new) | Resolved — stale vitest cache ghost suite `budget-nan-bypass.test.ts` | `2026-03-21T21:00:00Z` | 1 — self-resolved (cache cleared) |
| ~~BUG-0364~~ | Resolved — `sanitizeEnvValue()` fix already on main; all 5 tests passing | `2026-03-21T00:25:00Z` | 5 cycles stale — resolved Cycle 14 |
| BUG-0363 | `skill-loader-content-xml-escape.test.ts` — 3 tests failing, fix on `bugfix/BUG-0363` | `2026-03-21T22:45:00Z` | 6 |
| BUG-0436 | `agent-node-context-privilege-leak.test.ts` — 1 test failing, BUG-0399 regression (fix branch unmerged) | Cycle 40 | 1 |
| BUG-0312 | `pubsub-snapshot-during-publish.test.ts` — 2 tests failing, fix on `bugfix/BUG-0312` | Cycle 13+ | 6 |
| BUG-0401 | Ghost suite `skill-evolver-esm-path.test.ts` (0 tests, transient) | Cycle 18 | 2 |
| BUG-0402 | Mass ghost-suite surge — 10+ suites fail parallel run, pass in isolation | Cycle 19 | 1 — did NOT reproduce Cycle 20 (2 suites only, all known cooldowns) |

---

## Run History (Last 10)

| Timestamp | Result | Tests Run | Failed | Suites Failed | Build | Bugs Filed | Escalations |
|---|---|---|---|---|---|---|---|
| `2026-03-21T20:00:00Z` | `build-failure` | 0 | 0 | 0 | BROKEN | 0 | 0 |
| `2026-03-21T19:30:00Z` | `build-failure` | 0 | 0 | 0 | BROKEN | 0 | 0 |
| `2026-03-21T19:00:00Z` | `build-failure` | 0 | 0 | 0 | BROKEN | 0 | 0 |
| `2026-03-21T18:30:00Z` | `build-failure` | 0 | 0 | 0 | BROKEN | 0 | 0 |
| `2026-03-21T18:00:00Z` | `build-failure` | 0 | 0 | 0 | BROKEN | 0 | 0 |
| `2026-03-21T15:30:49Z` | `build-failure` | 0 | 0 | 0 | BROKEN | 0 | 0 |
| `2026-03-21T17:00:00Z` | `build-failure` | 0 | 0 | 0 | BROKEN | 0 | 0 |
| `2026-03-21T16:00:00Z` | `build-failure` | 0 | 0 | 0 | BROKEN | 0 | 0 |
| `2026-03-21T15:00:40Z` | `build-failure` | 0 | 0 | 0 | BROKEN | 0 | 0 |
| `2026-03-21T12:10:00Z` | `build-failure` | 0 | 0 | 0 | BROKEN | 0 | 0 |
| `2026-03-21T12:00:00Z` | `build-failure` | 0 | 0 | 0 | BROKEN | 0 | 0 |
| `2026-03-21T11:05:00Z` | `build-failure` | 0 | 0 | 0 | BROKEN | 0 | 0 |
| `2026-03-21T10:40:57Z` | `build-failure` | 0 | 0 | 0 | BROKEN | 0 | 0 |
| `2026-03-21T10:30:00Z` | `build-failure` | 0 | 0 | 0 | BROKEN | 1 | 1 |
| `2026-03-21T10:21:00Z` | `test-failures` | 1393 | 6 | 3 | CLEAN | 0 | 0 |
| `2026-03-21T10:14:00Z` | `test-failures` | 1393 | 6 | 3 | CLEAN | 1 | 0 |
| `2026-03-21T10:02:49Z` | `test-failures` | 1390 | 5 | 2 | CLEAN | 0 | 0 |
| `2026-03-21T02:52:03Z` | `test-failures` | 1390 | 5 | 2 | CLEAN | 0 | 0 |
| `2026-03-21T02:40:52Z` | `test-failures` | 1390 | 5 | 2 | CLEAN | 0 | 0 |
| `2026-03-21T09:32:48Z` | `test-failures` | 1390 | 5 | 2 | CLEAN | 0 | 0 |
| `2026-03-21T09:22:23Z` | `test-failures` | 1390 | 5 | 2 | CLEAN | 0 | 0 |
| `2026-03-21T11:00:00Z` | `test-failures` | 1390 | 5 | 2 | CLEAN | 0 | 0 |
| `2026-03-21T10:15:00Z` | `test-failures` | 1390 | 5 | 2 | CLEAN | 0 | 0 |
| `2026-03-21T09:35:00Z` | `test-failures` | 1386 | 5 | 2 | CLEAN | 0 | 0 |
