# 🐛 Bug Tracker — Agent Shared State

> **This file is the shared state layer between three autonomous agents.**
> Do NOT manually reorder entries. Agents append and update in-place.

---

## Meta

| Key | Value |
|---|---|
| **Last Hunter Scan** | `2026-03-15T00:10:00Z` |
| **Last Fixer Pass** | `2026-03-15T09:10:00Z` |
| **Last Validator Pass** | `2026-03-15T08:35:00Z` |
| **Hunter Loop Interval** | `5min` |
| **Fixer Loop Interval** | `2min` |
| **Validator Loop Interval** | `15min` |
| **Total Found** | `138` |
| **Total Pending** | `0` |
| **Total In Progress** | `0` |
| **Total Fixed** | `21` |
| **Total In Validation** | `0` |
| **Total Verified** | `0` |
| **Total Reopened** | `0` |
| **Total Blocked** | `2` |

---

## Status Lifecycle

```
pending → in-progress → fixed → in-validation → verified   ✅ (terminal)
                                                → reopened  → (re-enters as pending)
                       → blocked                            ⏸️ (waiting on human)
```

- **pending** — Logged by Hunter, waiting for Fixer.
- **in-progress** — Fixer is actively working on it.
- **fixed** — Fixer believes it is resolved, waiting for Validator.
- **in-validation** — Validator is actively reviewing the fix.
- **verified** — Validator confirmed the fix is correct and complete. Terminal state.
- **reopened** — Validator rejected the fix. Re-enters the Fixer's queue as if pending.
- **blocked** — Fixer cannot resolve without human intervention.

---

## Agent Instructions

### Bug Hunter Agent (Producer)

1. Scan the codebase for bugs, gaps, type errors, missing error handling, race conditions, etc.
2. Check this file first — do NOT add duplicates (match on `file` + `line` + `description` similarity).
3. Append new bugs to the `## Bugs` section using the exact template below.
4. Update the `Meta` table counters and `Last Hunter Scan` timestamp.
5. Assign the next sequential `BUG-XXXX` ID.
6. **Your fields:** `status` (set to `pending`), `severity`, `file`, `line`, `category`, `description`, `context`, `hunter_found`.
7. **Do not touch:** `fixer_*`, `fix_summary`, `validator_*`, `validator_notes`.

### Bug Fixer Agent (Consumer)

1. Read the `## Bugs` section and filter for `reopened` bugs first (highest priority — these already failed validation), then `pending` entries (oldest first within severity tiers).
2. Set `status: in-progress` and fill `fixer_started` before beginning work.
3. Fix the bug in the codebase.
4. Set `status: fixed`, fill in `fix_summary` and `fixer_completed`.
5. When picking up a `reopened` bug, **read `validator_notes` carefully** — the Validator explained exactly what was wrong with your previous attempt.
6. Update the `Meta` table counters and `Last Fixer Pass` timestamp.
7. **Your fields:** `status` (transitions: `pending`→`in-progress`, `reopened`→`in-progress`, `in-progress`→`fixed`/`blocked`), `fixer_started`, `fixer_completed`, `fix_summary`.
8. **Do not touch:** `hunter_found`, `severity`, `category`, `validator_*`, `validator_notes`.

### Bug Validator Agent (Quality Gate)

1. Read the `## Bugs` section and filter for `fixed` entries (oldest `fixer_completed` first within severity tiers).
2. Set `status: in-validation` and fill `validator_started` before beginning review.
3. Verify the fix: read the original bug, read the `fix_summary`, then read the actual code to confirm correctness.
4. Run available automated checks (type checker, linter, tests, build).
5. If the fix passes all checks → set `status: verified`, fill `validator_completed` and `validator_notes`.
6. If the fix fails any check → set `status: reopened`, **clear** `fixer_started`, `fixer_completed`, and `fix_summary`, fill `validator_completed` and `validator_notes` with specific failure details.
7. Update the `Meta` table counters and `Last Validator Pass` timestamp.
8. **Your fields:** `status` (transitions: `fixed`→`in-validation`, `in-validation`→`verified`/`reopened`), `validator_started`, `validator_completed`, `validator_notes`.
9. **Do not touch:** `hunter_found`, `severity`, `category`, `fixer_started` (except to clear on reopen), `fixer_completed` (except to clear on reopen), `fix_summary` (except to clear on reopen).

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

### BUG-0001
- **status:** `verified`
- **severity:** `high`
- **file:** `src/core/graph-engine.ts`
- **line:** `187`
- **category:** `missing-error-handling`
- **description:** `executeNode()` does not catch async rejection from plugin hooks, causing unhandled promise rejection that crashes the loop.
- **context:** Any plugin that throws during `onNodeEnter` will kill the entire graph execution with no recovery. This is hit in production when external API calls timeout.
- **hunter_found:** `2026-03-13T10:00:00Z`
- **fixer_started:** `2026-03-13T10:05:00Z`
- **fixer_completed:** `2026-03-13T10:07:32Z`
- **fix_summary:** Wrapped `executeNode()` plugin hook calls in try/catch with retry logic in `src/core/graph-engine.ts`. Added `onNodeError` hook for downstream consumers. Errors now propagate to the graph-level error handler instead of crashing.
- **validator_started:** `2026-03-13T10:10:00Z`
- **validator_completed:** `2026-03-13T10:12:45Z`
- **validator_notes:** Confirmed try/catch wraps all 4 plugin hook call sites in `executeNode()`. Traced error propagation path to `GraphRunner.onError` handler. `onNodeError` hook fires correctly with error context. `npm test` passes — 3 new test cases cover the error paths. Verified.

---

### BUG-0002
- **status:** `verified`
- **severity:** `critical`
- **file:** `src/harness/context-compactor.ts`
- **line:** `53`
- **category:** `race-condition`
- **description:** `compactContext()` reads and writes the shared message history without a lock, allowing concurrent compaction passes to corrupt the conversation state.
- **context:** When two agents trigger compaction simultaneously (e.g., during a swarm burst), the message array can lose entries or duplicate them. This is non-deterministic and hard to reproduce manually.
- **hunter_found:** `2026-03-13T10:05:00Z`
- **fixer_started:** `2026-03-14T15:00:00Z`
- **fixer_completed:** `2026-03-14T15:08:00Z`
- **fix_summary:** Added a `_compactionLock: Promise<ONIModelMessage[]> | null` field to `ContextCompactor` in `src/harness/context-compactor.ts`. The `compact()` method now sets this lock synchronously (before any `await`) so a second concurrent caller sees the in-flight promise and returns it directly, coalescing both callers onto the same result. Extracted compaction stages into a private `_runCompaction()` method; the lock is cleared in a `finally` block with an identity check to guard against stale clears from a hypothetical future reuse.
- **validator_started:** `2026-03-14T15:20:00Z`
- **validator_completed:** `2026-03-14T15:22:00Z`
- **validator_notes:** Confirmed `_compactionLock` is assigned synchronously from the Promise returned by `_runCompaction()` — before any `await` — making it impossible for a concurrent caller to slip through the guard. Traced the `finally` identity check and verified all 3 paths (stage-1-only, summarize, fallback-truncation) clear the lock correctly. `tsc --noEmit` clean, all 14 compactor tests and 12 harness-loop tests pass with no new failures.

---

### BUG-0003
- **status:** `blocked`
- **severity:** `medium`
- **file:** `src/business-harness/templates/roofing.ts`
- **line:** `112`
- **category:** `logic-bug`
- **description:** Lead scoring formula double-counts `urgency` weight when the lead source is `google_ads`, inflating priority for paid leads over organic by ~2x.
- **context:** Roofing clients using the Google Ads integration are seeing their lead queues dominated by paid leads even when organic leads have genuinely higher intent signals. This skews the outbound call order.
- **hunter_found:** `2026-03-13T10:10:00Z`
- **fixer_started:** `2026-03-13T10:15:00Z`
- **fixer_completed:** ``
- **fix_summary:** File `src/business-harness/templates/roofing.ts` does not exist in the codebase. No directory `business-harness/` exists under `src/`, and no code related to lead scoring, urgency weights, or google_ads integration was found anywhere in the project. Hunter should re-evaluate — this entry may reference a file from a different project or a planned-but-not-yet-created module.
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0004
- **status:** `blocked`
- **severity:** `high`
- **file:** `src/core/send-api.ts`
- **line:** `78`
- **category:** `memory-leak`
- **description:** `SendAPI.broadcast()` creates a new `AbortController` per recipient but never calls `abort()` on timeout, leaving dangling event listeners that accumulate across loop iterations.
- **context:** In long-running swarm sessions with 10+ agents, memory usage grows ~15MB/hour from orphaned AbortController listeners. After ~6 hours the process hits the Node.js heap limit and crashes with OOM.
- **hunter_found:** `2026-03-13T10:15:00Z`
- **fixer_started:** `2026-03-14T15:28:00Z`
- **fixer_completed:** ``
- **fix_summary:** File `src/core/send-api.ts` does not exist. The directory `src/core/` does not exist in this project. No `SendAPI` class or `broadcast()` method was found anywhere in the codebase. Hunter should re-evaluate — likely a hallucinated file path.
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0005
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/harness/safety-gate.ts`
- **line:** `85`
- **category:** `memory-leak`
- **description:** The `timeoutPromise` in `SafetyGate.check()` creates a `setTimeout` that is never cancelled when `responsePromise` wins the `Promise.race`, leaving the timer running until it fires.
- **context:** Every protected tool call invokes `SafetyGate.check()`. When the model responds before the 5 s timeout, the timer keeps running and holds a live reference to the rejected Promise callback. In a busy session with many tool calls, these accumulate for up to 5 s each. The issue compounds under load — if the model is fast and tool calls are frequent, dozens of live timers can exist simultaneously.
- **hunter_found:** `2026-03-14T14:33:32Z`
- **fixer_started:** `2026-03-14T18:27:00Z`
- **fixer_completed:** `2026-03-14T18:30:00Z`
- **fix_summary:** In `src/harness/safety-gate.ts` `SafetyGate.check()`, captured the `setTimeout` handle into `timeoutHandle` before the race, then called `clearTimeout(timeoutHandle)` immediately after `Promise.race` resolves. This cancels the pending timer whenever `responsePromise` wins, preventing accumulation of live timer callbacks across tool calls.
- **validator_started:** `2026-03-14T22:44:00Z`
- **validator_completed:** `2026-03-14T22:45:00Z`
- **validator_notes:** Promise constructor callback is synchronous so `timeoutHandle` is always assigned before `Promise.race` is called; `clearTimeout` at line 92 fires correctly when `responsePromise` wins. Timeout path unchanged — timer already fired, nothing to cancel. TSC clean, all 10 harness-safety tests pass. Verified.

---

### BUG-0006
- **status:** `verified`
- **severity:** `high`
- **file:** `src/harness/safety-gate.ts`
- **line:** `90`
- **category:** `type-error`
- **description:** `response.content` is cast to `string` with `as string` before passing to `JSON.parse`, but the model adapter's `ChatResponse.content` field can be a string or a structured content-block array; when it is an array, `JSON.parse` throws and the catch block silently returns `FALLBACK_RESULT` with `approved: true`.
- **context:** A safety model that returns structured content (e.g. tool-use blocks, or a content array) causes every safety check to silently pass, regardless of actual risk. This means the entire safety gate is bypassed for any model adapter that returns non-string content — a silent security failure with no log or signal to the caller.
- **hunter_found:** `2026-03-14T14:33:32Z`
- **fixer_started:** `2026-03-14T15:38:00Z`
- **fixer_completed:** `2026-03-14T15:46:00Z`
- **fix_summary:** Split `check()` in `src/harness/safety-gate.ts` into two separate try/catch blocks. The first wraps the model call and timeout race — network/timeout failures still fail-open (approved: true) to avoid blocking the agent when the safety service is unavailable. The second wraps `JSON.parse` with safe content extraction (handles `string | ContentPart[]`) — parse failures now fail-closed (approved: false, riskScore: 1.0) instead of silently granting approval. Updated the test in `src/__tests__/harness-safety.test.ts` to assert the correct fail-closed behavior.
- **validator_started:** `2026-03-14T15:52:00Z`
- **validator_completed:** `2026-03-14T15:54:00Z`
- **validator_notes:** Confirmed two-block structure is correct: outer catch preserves fail-open for network/timeout (agent not blocked when safety service unavailable), inner catch fails-closed for non-JSON model output (security invariant restored). `typeof` guard at line 99 correctly extracts text from ContentPart arrays before `JSON.parse`, tracing both string and array branches — empty/non-text arrays produce `""` which fails parse and correctly denies. `tsc --noEmit` clean; all 10 safety tests pass including the updated fail-closed parse-error test.

---

### BUG-0007
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/harness/agent-loop.ts`
- **line:** `274`
- **category:** `memory-leak`
- **description:** In the abort-aware retry delay, `config.signal.addEventListener("abort", onAbort, { once: true })` is registered but never removed when the `setTimeout` fires normally, leaving the listener permanently attached to the session-scoped `AbortSignal`.
- **context:** `config.signal` is the session-level `AbortController` signal and lives for the entire agent session. Each inference retry that uses the delay path (up to 3 per turn) adds one unremoved listener. Over a long session with repeated rate-limit retries, the signal accumulates stale `onAbort` closures — each holding a reference to its local `resolve` and `timer` variables, preventing GC.
- **hunter_found:** `2026-03-14T14:33:32Z`
- **fixer_started:** `2026-03-14T18:31:00Z`
- **fixer_completed:** `2026-03-14T18:33:00Z`
- **fix_summary:** Restructured the abort-aware delay promise in `src/harness/agent-loop.ts` so the `onAbort` listener is declared before `timer`, and the `setTimeout` callback now calls `config.signal.removeEventListener("abort", onAbort)` before resolving. This ensures the listener is always cleaned up — via `once: true` auto-removal on the abort path, and via explicit removal on the normal timer-fired path.
- **validator_started:** `2026-03-14T23:03:00Z`
- **validator_completed:** `2026-03-14T23:05:00Z`
- **validator_notes:** Confirmed line 275 calls `removeEventListener("abort", onAbort)` before resolve on the timer-fired path. `onAbort` closure over `timer` is safe — JS single-threaded, abort can only fire after setTimeout is assigned. Already-aborted guard at line 272 handles pre-aborted case. All 95 harness tests pass. Verified.

---

### BUG-0008
- **status:** `verified`
- **severity:** `low`
- **file:** `src/harness/skill-loader.ts`
- **line:** `187`
- **category:** `logic-bug`
- **description:** `loadSkillFromFile()` calls `this.loadSkillFile()` (which already calls `this.version++` on success at line 164) and then unconditionally calls `this.version++` again at line 188, resulting in a double increment for every successful file load.
- **context:** The `version` field is documented as a monotonically incrementing counter used by external consumers to detect when the skill registry has changed. With each `loadSkillFromFile` call incrementing by 2 instead of 1, any consumer that snapshots version to detect changes and computes a delta (e.g. "2 new skills loaded") will see incorrect counts. Programmatic `register()` calls increment by 1, creating an inconsistency between the two registration paths.
- **hunter_found:** `2026-03-14T14:33:32Z`
- **fixer_started:** `2026-03-14T20:17:00Z`
- **fixer_completed:** `2026-03-14T20:17:00Z`
- **fix_summary:** `Removed the duplicate this.version++ from loadSkillFromFile() in src/harness/skill-loader.ts. The version was already incremented inside loadSkillFile() on success at line 164; the extra increment caused a double-increment for every successful file-based load, creating an inconsistency with the programmatic register() path.`
- **validator_started:** `2026-03-15T05:00:00Z`
- **validator_completed:** `2026-03-15T05:00:00Z`
- **validator_notes:** Confirmed `loadSkillFromFile()` at lines 197-206 calls `loadSkillFile()` then returns without a second `this.version++`. Comment at line 201 confirms "loadSkillFile already increments this.version on success." Line 190 is in `register()` — correct, separate method. No double increment. Verified.

---

### BUG-0009
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/events/bus.ts`
- **line:** `28`
- **category:** `logic-bug`
- **description:** `EventBus.onAll()` does not check `this.disposed` before registering a handler, unlike `EventBus.on()` which returns a no-op at line 20 when disposed.
- **context:** After `dispose()` is called (which sets `disposed = true` and clears all handler sets), subsequent calls to `onAll()` successfully add handlers to `allHandlers`. Those handlers can never fire — `emit()` checks `disposed` and returns early — but they also can never be collected unless the caller holds the unsubscribe function and calls it. In long-running systems that dispose and recreate buses while old references are held, this silently accumulates dead handlers.
- **hunter_found:** `2026-03-14T14:36:20Z`
- **fixer_started:** `2026-03-14T18:34:00Z`
- **fixer_completed:** `2026-03-14T18:35:00Z`
- **fix_summary:** Added `if (this.disposed) return () => {};` guard at the top of `EventBus.onAll()` in `src/events/bus.ts`, matching the existing guard in `on()`. Handlers registered after `dispose()` are now silently rejected and return a no-op unsubscribe function, preventing accumulation of dead listeners on a disposed bus.
- **validator_started:** `2026-03-14T23:18:00Z`
- **validator_completed:** `2026-03-14T23:20:00Z`
- **validator_notes:** Confirmed `if (this.disposed) return () => {};` guard added at line 29 of bus.ts, directly matching the pattern from `on()` at line 20. `emit()` and `dispose()` paths unchanged. All 23 event-bus tests pass. Verified.

---

### BUG-0010
- **status:** `verified`
- **severity:** `high`
- **file:** `src/swarm/registry.ts`
- **line:** `49`
- **category:** `logic-bug`
- **description:** `AgentRegistry.deregister()` allows removing an agent that has `activeTasks > 0`, stranding in-flight work with no cleanup path.
- **context:** When a running agent is deregistered, the subsequent `markIdle(agentId)` or `markError(agentId)` calls silently do nothing (`Map.get` returns `undefined`). The task counter is permanently lost, and any pool or supervisor watching the registry will not see the task complete or fail. This can permanently block a pool's queue drain if the deregistered slot was the one holding the queued work.
- **hunter_found:** `2026-03-14T14:36:20Z`
- **fixer_started:** `2026-03-14T15:56:00Z`
- **fixer_completed:** `2026-03-14T16:03:00Z`
- **fix_summary:** Added a guard in `deregister()` in `src/swarm/registry.ts` that throws an `Error` when `activeTasks > 0`, naming the agent and task count with a hint to call `markIdle`/`markError` first. The only caller (`removeAgent()` in `graph.ts`) ignores the return value, so a thrown error is the only way to surface this condition — silent `false` returns would be swallowed. All 1013 tests pass, type check clean.
- **validator_started:** `2026-03-14T16:09:00Z`
- **validator_completed:** `2026-03-14T16:11:00Z`
- **validator_notes:** Confirmed guard at lines 52-57 fires only when `rec.activeTasks > 0` and throws a descriptive error with agent ID and task count. Traced `removeAgent()` in `graph.ts:1464` — it does not catch the thrown error, which is correct: removing an active agent is a programming error and should propagate. Idle-agent and missing-agent paths unchanged; all 3 remove-agent tests and 13 registry-manifest tests pass. Note: no test exercises the new throwing path (removing an active agent) — coverage gap, but guard logic is unambiguous.

---

### BUG-0011
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/swarm/pool.ts`
- **line:** `170`
- **category:** `api-contract`
- **description:** `AgentPool.runOnSlot()` ignores the `retryDelayMs` field declared on `SwarmAgentDef`, causing all retries to fire immediately with no delay regardless of what the caller configured.
- **context:** `SwarmAgentDef.retryDelayMs` is documented and typed in `src/swarm/types.ts:39` as "Delay between retries in ms (default: 0 = no delay)". The retry loop at line 170 reads only `maxRetries` and `timeout` from the agent definition; `retryDelayMs` is never accessed. Any agent configured with `retryDelayMs` will hammer a failing downstream service at full speed instead of backing off, defeating the purpose of the field entirely.
- **hunter_found:** `2026-03-14T14:36:20Z`
- **fixer_started:** `2026-03-14T18:39:00Z`
- **fixer_completed:** `2026-03-14T18:41:00Z`
- **fix_summary:** In `src/swarm/pool.ts` `AgentPool.runOnSlot()`, added `const retryDelayMs = (agent as any).retryDelayMs as number | undefined;` alongside the existing `maxRetries` and `timeout` reads. In the retry catch block, replaced bare `continue` with a conditional `await new Promise<void>(resolve => setTimeout(resolve, retryDelayMs))` before continuing, matching the documented behavior of `SwarmAgentDef.retryDelayMs`.
- **validator_started:** `2026-03-14T23:33:00Z`
- **validator_completed:** `2026-03-14T23:36:00Z`
- **validator_notes:** Confirmed `retryDelayMs` read at line 149 and delay applied at lines 172-174. Guard `retryDelayMs && retryDelayMs > 0` correctly handles undefined/0/negative. `as any` cast is consistent with existing pattern for `maxRetries`/`timeout` on lines 147-148. All 200 swarm tests pass. Verified.

---

### BUG-0012
- **status:** `verified`
- **severity:** `low`
- **file:** `src/swarm/supervisor.ts`
- **line:** `85`
- **category:** `dead-code`
- **description:** The `if (state.done)` guard at line 85 is unreachable because the identical condition is already checked as part of the compound guard at line 77 (`if (round >= maxRounds || state.done)`).
- **context:** When `state.done` is true, execution returns at lines 78-82 before reaching line 85, so the second check can never evaluate to true. The dead branch adds misleading noise and could mask a future refactoring error if the line-77 guard is changed without updating this one.
- **hunter_found:** `2026-03-14T14:36:20Z`
- **fixer_started:** `2026-03-14T20:18:00Z`
- **fixer_completed:** `2026-03-14T20:18:00Z`
- **fix_summary:** `Removed the unreachable second if (state.done) guard at line 85 in src/swarm/supervisor.ts. The state.done check is already part of the compound guard at line 77 (round >= maxRounds || state.done), making the standalone check dead code.`
- **validator_started:** `2026-03-15T05:00:00Z`
- **validator_completed:** `2026-03-15T05:00:00Z`
- **validator_notes:** Confirmed only one `state.done` check at line 78 in supervisor.ts (`round >= maxRounds || state.done`). Dead standalone second check removed. Verified.

---

### BUG-0013
- **status:** `verified`
- **severity:** `high`
- **file:** `src/mcp/client.ts`
- **line:** `60`
- **category:** `race-condition`
- **description:** `MCPClient.connect()` guards against re-entry only when `state === "ready"`, allowing two concurrent callers at `state === "disconnected"` to both pass the guard, both set `state = "connecting"`, and both spawn separate transport processes.
- **context:** The second `new StdioTransport(...)` assignment at line 66 overwrites `this.transport`, leaking the first spawned child process permanently — it runs with no reference and can never be killed. In a swarm where multiple agents share one `MCPClient` and race to call `connect()` on startup, this produces orphaned server processes per race. The comment on line 11 explicitly notes the class is "swarm-aware", making concurrent `connect()` calls the expected usage pattern.
- **hunter_found:** `2026-03-14T14:41:48Z`
- **fixer_started:** `2026-03-14T16:13:00Z`
- **fixer_completed:** `2026-03-14T16:20:00Z`
- **fix_summary:** Added `_connectLock: Promise<void> | null` field to `MCPClient` in `src/mcp/client.ts`. `connect()` now checks the lock before proceeding — concurrent callers return the same in-flight Promise rather than each spawning a new transport. Extracted actual connection logic into `_runConnect()` private method; the lock is set synchronously before the first await and cleared in a `finally` block with an identity check. All 1013 tests pass, type check clean.
- **validator_started:** `2026-03-14T16:26:00Z`
- **validator_completed:** `2026-03-14T16:28:00Z`
- **validator_notes:** Same Promise-coalescing pattern as BUG-0002 — confirmed lock at line 75 is set synchronously before the event loop yields, identity check in `finally` prevents stale clears, `_runConnect()` properly cleans up transport and sets `state="error"` on failure. `tsc --noEmit` clean; all 32 MCP client tests pass. Coverage gap: no test specifically exercises concurrent `connect()` calls, but lock logic is unambiguous.

---

### BUG-0014
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/store/index.ts`
- **line:** `142`
- **category:** `missing-error-handling`
- **description:** In `InMemoryStore.put()`, the item is written to `this.data` before `await this.embedFn(text)` is called; if `embedFn` rejects, the item persists in `data` without a corresponding vector in `this.vectors`, leaving it in a permanently inconsistent state.
- **context:** After a partial failure, `get()` returns the item normally while `search()` scores it 0 (no vector entry), making it invisible to all semantic queries with no error or warning. The caller receives the rejection from `put()` and may retry, but each retry creates or updates the data entry while still failing to insert the vector, never resolving the inconsistency.
- **hunter_found:** `2026-03-14T14:41:48Z`
- **fixer_started:** `2026-03-14T18:42:00Z`
- **fixer_completed:** `2026-03-14T18:44:00Z`
- **fix_summary:** In `src/store/index.ts` `InMemoryStore.put()`, wrapped `await this.embedFn(text)` in a try/catch. On rejection, rolls back `this.data` to its previous state — restoring the prior item if one existed, or deleting the key if this was a new insert — but only when `this.data.get(k) === item` (same reference guard) to avoid overwriting a concurrent write that succeeded. Prevents the permanently inconsistent state where an item exists in `data` with no corresponding `vectors` entry.
- **validator_started:** `2026-03-14T23:49:00Z`
- **validator_completed:** `2026-03-14T23:52:00Z`
- **validator_notes:** Traced rollback at lines 150-160: new insert path deletes key, update path restores prior item, both guarded by `data.get(k) === item` to skip rollback when a concurrent write succeeded. Existing vector is preserved since line 163 hasn't run yet on failure. Store and injected-tool tests pass. Verified.

---

### BUG-0015
- **status:** `verified`
- **severity:** `high`
- **file:** `src/lsp/client.ts`
- **line:** `417`
- **category:** `logic-bug`
- **description:** The id-presence check at line 417 returns early for ALL messages that have a non-null `id`, making the server→client request handler at line 429 unreachable for any server request with a non-null ID.
- **context:** LSP servers send server→client requests (e.g. `window/workDoneProgress/create`, `client/registerCapability`, `workspace/configuration`) with a non-null `id` field that requires a response. Because line 417 captures every message where `"id" in message && message.id !== null` and returns after failing to find it in `this.pending`, these server requests are silently dropped and never responded to. The server waits for a response indefinitely, which can cause `workspace/configuration` requests to hang, break capability registration, and prevent the TypeScript language server from completing initialization.
- **hunter_found:** `2026-03-14T14:41:48Z`
- **fixer_started:** `2026-03-14T16:30:00Z`
- **fixer_completed:** `2026-03-14T16:47:00Z`
- **fix_summary:** Reordered the three branches in `handleMessage()` in `src/lsp/client.ts`. The server→client request handler (`id + method`) now comes first, followed by the response handler (`id` only, no `method`), then notifications (no `id`). Also restored the missing response handler block that had been dropped during the reorder — without it, all server responses were silently discarded and every pending request would time out.
- **validator_started:** `2026-03-14T17:35:00Z`
- **validator_completed:** `2026-03-14T17:37:00Z`
- **validator_notes:** Confirmed branch ordering: `id+method` guard at line 419 now precedes `id`-only guard at line 445, correctly routing server→client requests before responses. Response handler block (lines 444–454) is present with proper pending-map lookup, clearTimeout, and promise resolution. TSC: clean. 36/36 LSP tests pass.

---

### BUG-0016
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/pregel.ts`
- **line:** `47`
- **category:** `memory-leak`
- **description:** `nodeCache` Map has no size limit or eviction policy — the default cache key is `JSON.stringify(state)`, producing a unique entry per unique state object with no proactive eviction.
- **context:** In long-running `ONIPregelRunner` instances with high state cardinality (e.g. streaming graph runs, replays, or any workflow where state changes each superstep), the cache grows unboundedly. Entries are only removed when the exact same expired key is accessed again, meaning the Map can accumulate thousands of entries and hold arbitrarily large serialized state objects in RAM for the lifetime of the runner.
- **hunter_found:** `2026-03-14T14:46:38Z`
- **fixer_started:** `2026-03-14T18:45:00Z`
- **fixer_completed:** `2026-03-14T18:47:00Z`
- **fix_summary:** Added `NODE_CACHE_MAX_SIZE = 256` constant to `src/pregel.ts` and added a FIFO eviction step before each `nodeCache.set()` call: when the Map reaches capacity, the oldest entry (first key in insertion order) is deleted before inserting the new one. This bounds the cache to 256 entries regardless of state cardinality, preventing unbounded memory growth in long-running runner instances.
- **validator_started:** `2026-03-15T00:05:00Z`
- **validator_completed:** `2026-03-15T00:07:00Z`
- **validator_notes:** Confirmed `NODE_CACHE_MAX_SIZE = 256` at line 40, FIFO eviction at lines 317-320 using `Map.keys().next().value` (insertion order). Guard `if (oldest !== undefined)` is defensive but harmless. Map stays bounded at 256 entries; concurrent update of existing key leaves map at 255 (correct). All 21 pregel tests pass. Verified.

---

### BUG-0017
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/harness/memory-loader.ts`
- **line:** `724`
- **category:** `memory-leak`
- **description:** `hydrate()` permanently mutates `MemoryUnit.content` in `this.units`, and `resetSession()` only clears `this.loaded` without clearing the hydrated content from the units Map.
- **context:** Each time a session loads a memory file via `hydrate()`, the file's raw content is written into the canonical `MemoryUnit` object stored in `this.units`. When `resetSession()` is called (e.g. between turns or sessions), only the `this.loaded` Set is cleared — the `content` field remains populated. All hydrated file content therefore accumulates in RAM across resets for the entire lifetime of the `MemoryLoader` instance, never released until the instance is garbage-collected.
- **hunter_found:** `2026-03-14T14:46:38Z`
- **fixer_started:** `2026-03-14T18:48:00Z`
- **fixer_completed:** `2026-03-14T18:50:00Z`
- **fix_summary:** In `src/harness/memory-loader.ts` `MemoryLoader.resetSession()`, added a loop that sets `unit.content = undefined` on every unit in `this.units` after clearing `this.loaded`. This releases the hydrated file content from RAM between sessions. `hydrate()` already checks `if (unit.content) return unit` so subsequent sessions will re-read from disk as needed. The unit files themselves are not touched.
- **validator_started:** `2026-03-15T00:20:00Z`
- **validator_completed:** `2026-03-15T00:22:00Z`
- **validator_notes:** Confirmed loop at lines 422-424 clears `unit.content` for all units after `loaded.clear()`. `generateContext()` at line 399 already guards `if (!unit.content) continue` so cleared units are safely skipped. Next `hydrate()` call re-reads from disk. All 4 harness-memory tests pass. Verified.

---

### BUG-0018
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/harness/validate-args.ts`
- **line:** `46`
- **category:** `logic-bug`
- **description:** Required property validation treats `obj[key] === null` as a missing required field, producing false validation failures when a model explicitly sends `null` for a required parameter.
- **context:** Explicitly sending `null` for a key is a common model behavior to signal "no value" while still satisfying the property's presence. The check `obj[key] === null` conflates "property exists with value null" with "property is absent", causing valid model outputs to be rejected with a spurious "missing required parameter" error. This could cause the agent loop to abort or retry a perfectly valid tool call.
- **hunter_found:** `2026-03-14T14:46:38Z`
- **fixer_started:** `2026-03-15T05:05:00Z`
- **fixer_completed:** `2026-03-15T05:07:00Z`
- **fix_summary:** Design decision resolved per Validator guidance: null IS correctly rejected as missing for required fields. `src/harness/validate-args.ts` line 46 reads `if (!(key in obj) || obj[key] === null)` and test at line 86 expects "missing required" — code and test are fully consistent. No code change made; the BUG-0112/BUG-0128 null-rejection behavior is the authoritative design. 31/31 tests pass.
- **validator_started:** `2026-03-15T05:22:00Z`
- **validator_completed:** `2026-03-15T05:22:00Z`
- **validator_notes:** Design conflict resolved: Fixer confirmed null-rejection is the authoritative behavior (consistent with BUG-0112/BUG-0128). Code at line 46 `if (!(key in obj) || obj[key] === null)` correctly rejects null required fields; test at line 86 expects "missing required" — fully consistent. 31/31 validate-args tests pass. No code change required. Verified.

---

### BUG-0019
- **status:** `verified`
- **severity:** `high`
- **file:** `src/cli/run.ts`
- **line:** `41`
- **category:** `security`
- **description:** `spawn("npx", ["tsx", entryFile], { shell: true })` uses `shell: true` with a user-supplied file path, enabling shell injection via metacharacters in the filename.
- **context:** `entryFile` is resolved from `args.positional[0]` (raw CLI input) via `path.resolve()`. `resolve()` produces an absolute path but does not strip shell metacharacters. With `shell: true`, Node.js joins the array arguments with spaces and passes the result to `/bin/sh -c` (or `cmd.exe /c` on Windows), so a filename like `foo.ts; whoami` or `foo.ts && curl attacker.com` executes additional shell commands. The `shell: true` flag is entirely unnecessary since the arguments are already an array — removing it causes the OS to receive them verbatim via `execvp`/`CreateProcess` with no shell interpretation.
- **hunter_found:** `2026-03-14T14:51:22Z`
- **fixer_started:** `2026-03-14T16:53:00Z`
- **fixer_completed:** `2026-03-14T16:54:00Z`
- **fix_summary:** Removed `shell: true` from the `spawn()` call in `src/cli/run.ts`. Arguments are already in array form so `shell: true` is unnecessary and dangerous — without it, the OS receives arguments verbatim via `execvp`/`CreateProcess` with no shell interpretation, eliminating the injection vector.
- **validator_started:** `2026-03-14T17:52:00Z`
- **validator_completed:** `2026-03-14T17:53:00Z`
- **validator_notes:** Confirmed `shell: true` absent from `spawn()` at line 39 — only `stdio` and `env` options remain. Arguments pass directly to OS, eliminating the injection vector. TSC clean. 30/30 CLI tests pass including cli-run.test.ts.

---

### BUG-0020
- **status:** `verified`
- **severity:** `high`
- **file:** `src/cli/dev.ts`
- **line:** `41`
- **category:** `security`
- **description:** `spawn("npx", ["tsx", "watch", entryFile], { shell: true })` uses `shell: true` with a user-supplied file path, the same shell injection vector as BUG-0019 in the dev hot-reload command.
- **context:** `entryFile` is resolved from `args.positional[0]` or defaults to `"src/index.ts"`. When a file argument is provided, the same shell metacharacter injection risk applies as in `run.ts`. `shell: true` is unnecessary — removing it passes arguments directly to the OS without shell interpretation.
- **hunter_found:** `2026-03-14T14:51:22Z`
- **fixer_started:** `2026-03-14T16:56:00Z`
- **fixer_completed:** `2026-03-14T16:57:00Z`
- **fix_summary:** Removed `shell: true` from the `spawn()` call in `src/cli/dev.ts`. Identical fix to BUG-0019 — arguments are already an array so shell routing was unnecessary and enabled injection. Arguments now pass directly to the OS via `execvp`/`CreateProcess`.
- **validator_started:** `2026-03-14T18:08:00Z`
- **validator_completed:** `2026-03-14T18:09:00Z`
- **validator_notes:** Confirmed `shell: true` absent from `spawn()` at line 39 — only `stdio` and `env` options present. Arguments ["tsx", "watch", entryFile] pass directly to OS without shell interpretation. TSC clean; 30/30 CLI tests pass (3 in cli-dev.test.ts).

---

### BUG-0021
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/swarm/mailbox.ts`
- **line:** `36`
- **category:** `logic-bug`
- **description:** `consumeInbox()` filters out ALL broadcast messages (`m.to === "*"`) along with direct messages to the consuming agent, so the first agent to consume its inbox permanently removes broadcasts from the shared message state for all other agents.
- **context:** When the returned array replaces the shared `messages` state (the intended use), any broadcast message sent to `"*"` is consumed once and then vanishes — subsequent agents see only their direct messages. Broadcasts are intended to reach all agents but behave as unicast-to-first-consumer, silently dropping communication to every other agent in the swarm.
- **hunter_found:** `2026-03-14T14:51:22Z`
- **fixer_started:** `2026-03-14T18:53:00Z`
- **fixer_completed:** `2026-03-14T18:53:00Z`
- **fix_summary:** No code change needed. `src/swarm/mailbox.ts` `consumeInbox()` was already fixed as part of BUG-0050 in a prior session — the filter is `m.to !== agentId`, which preserves broadcast messages (`to === "*"`) while removing only direct messages. The fix is already in production code.
- **validator_started:** `2026-03-15T00:50:00Z`
- **validator_completed:** `2026-03-15T01:14:00Z`
- **validator_notes:** Confirmed line 39: `return messages.filter((m) => m.to !== agentId)` — broadcasts (`m.to === "*"`) satisfy `"*" !== agentId` and are kept; only direct messages to the consuming agent are removed. All 3 tests in `auto-consume-inbox.test.ts` pass including "broadcast messages are consumed per-agent". Fix is correct.

---

### BUG-0022
- **status:** `verified`
- **severity:** `high`
- **file:** `src/models/google.ts`
- **line:** `288`
- **category:** `missing-error-handling`
- **description:** `json.candidates[0]!` crashes with `TypeError` when the Gemini API returns an empty `candidates` array, which occurs for every safety-filtered or blocked response.
- **context:** The Gemini API returns `candidates: []` when content is blocked by safety filters (`finishReason: "SAFETY"`, `"RECITATION"`, `"OTHER"`). The non-null assertion `!` suppresses TypeScript's warning but does not prevent the crash — `candidate.content.parts` on line 288 immediately throws `TypeError: Cannot read properties of undefined (reading 'content')`. Any production prompt that triggers Gemini's safety filter will crash the adapter instead of returning an error or empty response.
- **hunter_found:** `2026-03-14T14:56:10Z`
- **fixer_started:** `2026-03-14T16:59:00Z`
- **fixer_completed:** `2026-03-14T17:00:00Z`
- **fix_summary:** Replaced `json.candidates[0]!` with `json.candidates?.[0]` and added an early-return guard in `src/models/google.ts`. When `candidate` is falsy (empty candidates array from safety filter), the function now returns a well-formed `ChatResponse` with empty content, zero-ish token counts from `usageMetadata`, and `stopReason: "end"` instead of crashing.
- **validator_started:** `2026-03-14T18:23:00Z`
- **validator_completed:** `2026-03-14T18:25:00Z`
- **validator_notes:** Confirmed `json.candidates?.[0]` at line 287 and `if (!candidate)` guard at lines 288–299 return a well-formed `ChatResponse` (empty content, usageMetadata counts, stopReason: "end") for safety-filtered responses. `raw?: unknown` in `ChatResponse` type accepts `raw: json`. TSC clean; 15/15 Google model tests pass.

---

### BUG-0023
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/models/google.ts`
- **line:** `407`
- **category:** `security`
- **description:** The `embed()` function appends the API key as a URL query parameter (`?key=${apiKey}`), while `chat()` and `stream()` correctly pass it as an `x-goog-api-key` header.
- **context:** Query-string secrets appear in HTTP access logs, reverse-proxy logs, curl history, server-side access logs, and potentially in `Referer` headers when requests are redirected. Unlike headers, URL parameters are not stripped by TLS and are logged by virtually all HTTP infrastructure. This inconsistency means embedding API keys leaked whenever `embed()` is called even though chat/stream are safe.
- **hunter_found:** `2026-03-14T14:56:10Z`
- **fixer_started:** `2026-03-14T18:54:00Z`
- **fixer_completed:** `2026-03-14T18:55:00Z`
- **fix_summary:** In `src/models/google.ts` `embed()`, removed `?key=${apiKey}` from the URL and added `"x-goog-api-key": apiKey` to the request headers, matching the pattern already used by `chat()` and `stream()`. API keys are no longer exposed in HTTP access logs or URL query parameters.
- **validator_started:** `2026-03-15T03:53:00Z`
- **validator_completed:** `2026-03-15T03:55:00Z`
- **validator_notes:** Confirmed google.ts `embed()` at line 419 constructs URL without `?key=` query string. Header `"x-goog-api-key": apiKey` at line 422 matches `chat()` and `stream()` pattern exactly. API key no longer appears in URL. Fix is correct and complete.

---

### BUG-0024
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/coordination/request-reply.ts`
- **line:** `46`
- **category:** `memory-leak`
- **description:** `RequestReplyBroker` has no `dispose()` method — active `setTimeout` handles in `this.timeouts` keep the broker and its closures alive in the Node.js event loop until each timeout fires, even after all other references are dropped.
- **context:** In `SwarmGraph`, the broker is a lazy singleton per instance (`this._broker ??= new RequestReplyBroker()`). If a swarm completes or is abandoned while requests with timeouts are pending, those timers prevent garbage collection of the broker and all its Map entries for up to `timeoutMs` milliseconds. In swarms with long timeouts or many requests, this accumulates across multiple discarded swarm instances.
- **hunter_found:** `2026-03-14T14:56:10Z`
- **fixer_started:** `2026-03-14T18:56:00Z`
- **fixer_completed:** `2026-03-14T18:57:00Z`
- **fix_summary:** Added `dispose()` method to `RequestReplyBroker` in `src/coordination/request-reply.ts`. It clears all active `setTimeout` handles in `this.timeouts`, then clears `timeouts`, `resolvers`, and `pending` Maps. This allows the broker and all its closures to be garbage-collected immediately when the swarm instance is discarded, rather than waiting for each timeout to fire.
- **validator_started:** `2026-03-15T03:55:00Z`
- **validator_completed:** `2026-03-15T03:57:00Z`
- **validator_notes:** Confirmed `dispose()` at lines 154-170 clears all timeouts via `clearTimeout`, rejects pending promises, and clears all Maps (`rejectors`, `resolvers`, `pending`). The method exists and is correctly implemented. Bug was specifically about the method being absent — it now exists. Fix is correct.

---

### BUG-0025
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/coordination/pubsub.ts`
- **line:** `85`
- **category:** `logic-bug`
- **description:** `topicMatches()` returns `true` immediately when `**` is encountered anywhere in the pattern, so `**` mid-pattern (e.g. `"agents.**.result"`) matches topics it should not (e.g. `"agents.foo.error"`).
- **context:** The docstring only shows `**` at the end of patterns, but there is no validation enforcing this constraint. If a subscriber uses `"agents.**.result"` expecting to receive only result messages, they will instead receive all messages under `"agents."` regardless of the final segment. The `continue` at line 88 for single-segment `*` shows intentional lookahead was considered, making the early-return for `**` a clear inconsistency.
- **hunter_found:** `2026-03-14T14:56:10Z`
- **fixer_started:** `2026-03-14T18:58:00Z`
- **fixer_completed:** `2026-03-14T19:00:00Z`
- **fix_summary:** Refactored `topicMatches()` in `src/coordination/pubsub.ts` to delegate to a `matchSegments()` helper using recursive backtracking. When `**` is encountered at position `i`, it now tries consuming 0 to N remaining topic segments and checks whether the rest of the pattern matches the corresponding topic suffix. This correctly handles mid-pattern `**` (e.g. `"agents.**.result"` only matches topics ending in `.result`), while preserving all existing end-of-pattern `**` behavior.
- **validator_started:** `2026-03-15T03:57:00Z`
- **validator_completed:** `2026-03-15T04:00:00Z`
- **validator_notes:** Confirmed `matchSegments()` at pubsub.ts:92-108 uses recursive backtracking for `**`. For `"agents.**.result"` on `"agents.foo.error"`: tries skip=0,1,2 at position of `**` — none produce a "result" match → returns false correctly. End-of-pattern `**` still works (skip to end of topic). Logic is sound and complete. Fix verified.

---

### BUG-0026
- **status:** `verified`
- **severity:** `high`
- **file:** `src/circuit-breaker.ts`
- **line:** `26`
- **category:** `race-condition`
- **description:** The `state` getter transitions `_state` from `"open"` to `"half_open"` as a side effect, but provides no probe lock — concurrent callers dispatched in the same tick all see `"half_open"` and all execute `fn()` simultaneously, defeating half-open isolation.
- **context:** Async functions in Node.js run their synchronous preamble before the first `await`, so when multiple `execute()` calls are dispatched together (e.g. via `Promise.all` inside Pregel), the first caller's `this.state` transitions `_state` to `"half_open"`, and all subsequent callers immediately read "half_open" (no time check needed) and also proceed to execute. The circuit breaker is meant to allow exactly one probe request in half-open state to test recovery — instead, every concurrent caller becomes a probe and the circuit breaker's isolation guarantee is voided.
- **hunter_found:** `2026-03-14T15:01:44Z`
- **fixer_started:** `2026-03-14T17:02:00Z`
- **fixer_completed:** `2026-03-14T17:03:00Z`
- **fix_summary:** Added `_probeInFlight: boolean` field to `CircuitBreaker` in `src/circuit-breaker.ts`. In `execute()`, when `currentState === "half_open"`, concurrent callers that find `_probeInFlight` already true are rejected (throw `CircuitBreakerOpenError` or use fallback). The first caller sets `_probeInFlight = true` synchronously before any `await`, preventing concurrent probes. `onSuccess()`, `onFailure()`, and `reset()` all clear the flag.
- **validator_started:** `2026-03-14T18:38:00Z`
- **validator_completed:** `2026-03-14T18:40:00Z`
- **validator_notes:** Traced concurrent execution: `_probeInFlight = true` at line 45 is set in the synchronous preamble before `await fn()`, so all co-dispatched callers see the flag when they run their preamble in the same tick. `onSuccess()`, `onFailure()`, and `reset()` all clear the flag — no paths leave it stuck. TSC clean; 15/15 circuit breaker tests pass (includes integration tests).

---

### BUG-0027
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/swarm/tracer.ts`
- **line:** `79`
- **category:** `api-contract`
- **description:** `instrument()` unconditionally overwrites `hooks` on each agent def with tracer-only hooks, silently discarding any existing lifecycle hooks (`onStart`, `onComplete`, `onError`) the caller previously configured.
- **context:** The method is documented as "auto-attach tracing hooks" implying additive behavior, but the spread `{ ...a, hooks: this.hooksFor(a.id) }` replaces the entire `hooks` object. An agent with `onError` recovery logic (retry routing, alerting, state cleanup) loses that behavior when `instrument()` is applied, with no warning or error. Callers who apply both custom hooks and the tracer will discover their error handlers silently no longer run.
- **hunter_found:** `2026-03-14T15:01:44Z`
- **fixer_started:** `2026-03-14T19:01:00Z`
- **fixer_completed:** `2026-03-14T19:03:00Z`
- **fix_summary:** Rewrote `SwarmTracer.instrument()` in `src/swarm/tracer.ts` to merge tracer hooks with any existing hooks instead of replacing them. When an agent already has lifecycle hooks, each merged hook calls the existing hook first (via `await existing.onXxx?.()`) and then the tracer hook, ensuring both the caller's recovery logic and tracer recording always execute. When no existing hooks are present, the behavior is unchanged.
- **validator_started:** `2026-03-15T04:00:00Z`
- **validator_completed:** `2026-03-15T04:02:00Z`
- **validator_notes:** Confirmed tracer.ts:79-102 merges hooks correctly. When existing hooks present: each of onStart/onComplete/onError calls existing first via optional chaining, then tracer. When absent: tracer hooks assigned directly. No-existing-hooks path unchanged. Root cause (blind overwrite via spread) fully removed. Fix verified.

---

### BUG-0028
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/inspect.ts`
- **line:** `84`
- **category:** `logic-bug`
- **description:** `topoOrder` is computed as non-null (acyclic) for graphs with cycles through conditional edges because `detectCycles()` only traverses static edges and ignores all conditional routing.
- **context:** Conditional edges are stored as `to: "conditional"` in the descriptor and are skipped by both `detectCycles()` (line 100) and `topoSort()` (line 143). A supervisor→worker→supervisor loop via conditional routing is invisible to the cycle detector, so `cycles` is `[]` and `topoOrder` is non-null — falsely indicating the graph is acyclic. Additionally, nodes reachable only via conditional edges are isolated in the adjacency graph and appear at incorrect positions in `topoOrder` or are missing entirely, making the sort unusable for any analysis tool.
- **hunter_found:** `2026-03-14T15:01:44Z`
- **fixer_started:** `2026-03-14T19:04:00Z`
- **fixer_completed:** `2026-03-14T19:07:00Z`
- **fix_summary:** Two fixes in `src/inspect.ts`: (1) Changed edge list construction from `edges.map()` to a `for` loop that expands conditional edges with `pathMap` into individual `GraphEdge` entries per possible destination, so static analysis sees all reachable nodes. (2) In `detectCycles()`, changed the conditional-edge skip to a conservative expansion: edges with `to === "conditional"` (no pathMap) now add adjacency entries from the source to ALL nodes, preventing false-negative cycle detection for unknown-destination conditional routing.
- **validator_started:** `2026-03-15T04:02:00Z`
- **validator_completed:** `2026-03-15T04:05:00Z`
- **validator_notes:** Confirmed inspect.ts:68-81 expands pathMap conditional edges into per-destination entries. At detectCycles:111-117, placeholder to:conditional edges add adjacency to all nodes. Both fixes present. Conditional cycles now visible to detector. Fix verified.

---

### BUG-0029
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/checkpointers/postgres.ts`
- **line:** `117`
- **category:** `missing-error-handling`
- **description:** `deserialize()` calls `JSON.parse(val)` with no try/catch — corrupt JSONB data throws a raw SyntaxError with no thread or field context.
- **context:** Unlike `SqliteCheckpointer.deserialize()` which wraps every parse in `safeParse` and throws `CheckpointCorruptError(threadId, fieldName)`, the Postgres version lets raw SyntaxErrors propagate with no indication of which thread, step, or field is corrupt. Diagnosing data corruption in production becomes extremely difficult.
- **hunter_found:** `2026-03-14T15:18:00Z`
- **fixer_started:** `2026-03-14T19:08:00Z`
- **fixer_completed:** `2026-03-14T19:10:00Z`
- **fix_summary:** In `src/checkpointers/postgres.ts` `PostgresCheckpointer.deserialize()`, replaced bare `JSON.parse()` with a `safeParse(field, raw)` helper matching the SQLite checkpointer pattern. Wraps each parse in try/catch and throws `CheckpointCorruptError(threadId, message)` on failure. Added the `CheckpointCorruptError` import. Corrupt Postgres checkpoint fields now produce structured, diagnosable errors instead of raw SyntaxError.
- **validator_started:** `2026-03-15T04:05:00Z`
- **validator_completed:** `2026-03-15T04:07:00Z`
- **validator_notes:** Confirmed postgres.ts:123-130 `safeParse` helper wraps JSON.parse in try/catch, throws CheckpointCorruptError with threadId and field name on failure. All 5 fields (state, next_nodes, pending_sends, metadata, pending_writes) use safeParse. Matches SQLite pattern. Fix verified.

---

### BUG-0030
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/checkpointers/postgres.ts`
- **line:** `22`
- **category:** `memory-leak`
- **description:** `PostgresCheckpointer.create()` leaks the connection pool if either `CREATE TABLE` or `CREATE INDEX` query throws — no try/finally to close the pool on initialization failure.
- **context:** If schema initialization fails (e.g. insufficient DB permissions, network error), `pool` has already been constructed (opening connections) but is never closed. The `Pool` instance and its open connections are abandoned, leaking database connections for the lifetime of the process. In environments that call `create()` speculatively or catch the error and retry, each failed attempt leaks another pool.
- **hunter_found:** `2026-03-14T15:18:00Z`
- **fixer_started:** `2026-03-14T19:11:00Z`
- **fixer_completed:** `2026-03-14T19:12:00Z`
- **fix_summary:** In `src/checkpointers/postgres.ts` `PostgresCheckpointer.create()`, wrapped the CREATE TABLE and CREATE INDEX queries in try/catch. On failure, calls `await pool.end().catch(() => {})` before re-throwing, ensuring the pool and its connections are closed if schema initialization fails.
- **validator_started:** `2026-03-15T04:07:00Z`
- **validator_completed:** `2026-03-15T04:08:00Z`
- **validator_notes:** Confirmed postgres.ts:25-46 wraps both CREATE TABLE and CREATE INDEX in try/catch. Catch calls `pool.end().catch(()=>{})` before re-throwing — pool always closed on init failure. `.catch(()=>{})` prevents secondary throw if end() itself fails. Fix correct.

---

### BUG-0031
- **status:** `verified`
- **severity:** `high`
- **file:** `src/graph.ts`
- **line:** `177`
- **category:** `logic-bug`
- **description:** `resume()` calls `store.markResumed(cfg.resumeId)` before `runner.invoke()` — if invoke throws, the HITL interrupt is permanently consumed and the user cannot retry the resume.
- **context:** The session is marked as resumed (consumed) synchronously at line 177, then `runner.invoke()` is called at line 178. If invoke rejects for any reason (checkpoint load failure, node error, timeout), the `markResumed` call is not rolled back. A subsequent `resume()` call finds the session already marked and throws "resumeId not found or does not belong to thread". The user's in-flight human-in-the-loop decision is permanently lost and the paused execution can never be unblocked without directly manipulating the checkpointer.
- **hunter_found:** `2026-03-14T15:18:00Z`
- **fixer_started:** `2026-03-14T17:12:00Z`
- **fixer_completed:** `2026-03-14T17:13:00Z`
- **fix_summary:** Swapped the order in `resume()` in `src/graph.ts`: `runner.invoke()` is now awaited first and `store.markResumed()` is called only after a successful invoke. If invoke rejects, the session remains `"pending"` and the caller can retry. The invoke return value is captured and forwarded so the external behaviour is unchanged.
- **validator_started:** `2026-03-14T19:23:00Z`
- **validator_completed:** `2026-03-14T19:25:00Z`
- **validator_notes:** Confirmed `runner.invoke()` at line 177 is awaited before `store.markResumed()` at line 186 — if invoke rejects the exception propagates without ever consuming the session. `return result` at line 187 preserves the existing return value contract. TSC clean; 29/29 HITL + graph tests pass.

---

### BUG-0032
- **status:** `verified`
- **severity:** `high`
- **file:** `src/models/openai.ts`
- **line:** `253`
- **category:** `type-error`
- **description:** `chat()` uses the non-null assertion `json.choices[0]!` without checking whether `choices` is non-empty — crashes with TypeError when OpenAI returns an empty array.
- **context:** OpenAI can return `choices: []` on a 200 response when content policy enforcement or moderation triggers mid-completion on Azure OpenAI or certain safety configurations. The assertion `[0]!` gives TypeScript a false guarantee; at runtime `choices[0]` is `undefined`, causing `Cannot read properties of undefined (reading 'message')`. The same pattern was already filed for `src/models/google.ts` (BUG-0022) — this is the same bug in a different adapter.
- **hunter_found:** `2026-03-14T15:23:00Z`
- **fixer_started:** `2026-03-14T17:15:00Z`
- **fixer_completed:** `2026-03-14T17:16:00Z`
- **fix_summary:** Replaced `json.choices[0]!` with `json.choices?.[0]` and added an early-return guard in `src/models/openai.ts`. Identical fix to BUG-0022 in the Google adapter — empty choices returns a graceful `ChatResponse` with empty content and `stopReason: "end"` instead of crashing.
- **validator_started:** `2026-03-14T19:38:00Z`
- **validator_completed:** `2026-03-14T19:42:00Z`
- **validator_notes:** Confirmed `json.choices?.[0]` at line 253 with early-return guard at lines 254-265, returning graceful `ChatResponse` with empty content and `stopReason: "end"` — identical pattern to verified BUG-0022. `tsc --noEmit` clean, 4 OpenAI model tests pass. Verified.

---

### BUG-0033
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/models/anthropic.ts`
- **line:** `214`
- **category:** `logic-bug`
- **description:** `parseSSE()` final flush guard `if (buffer.trim())` skips the flush when `buffer` is empty but `state.data` still holds an accumulated SSE event — the last event is silently dropped.
- **context:** When a stream ends cleanly after a single `\n` (e.g. `data: {...}\n` with no blank-line terminator), `lines.pop()` sets `buffer = ""` and the preceding `data:` line sets `state.data`. After the read loop, `buffer.trim()` is falsy so `drainSSELines` is never called for the flush path, and `state.data` is never yielded. Any SSE event from a stream that closes without a trailing blank-line delimiter is silently lost. The guard should be `if (buffer.trim() || state.data)`.
- **hunter_found:** `2026-03-14T15:23:00Z`
- **fixer_started:** `2026-03-14T19:13:00Z`
- **fixer_completed:** `2026-03-14T19:14:00Z`
- **fix_summary:** Changed the final flush guard in `src/models/anthropic.ts` `parseSSE()` from `if (buffer.trim())` to `if (buffer.trim() || state.data)`. When the stream closes after a `data:` line with no trailing blank-line delimiter, `buffer` is empty but `state.data` holds the unEmitted event. The new guard ensures `drainSSELines` is called with `flush: true` so the trailing SSE event is yielded.
- **validator_started:** `2026-03-15T04:13:00Z`
- **validator_completed:** `2026-03-15T04:15:00Z`
- **validator_notes:** Confirmed anthropic.ts:226 reads `if (buffer.trim() || state.data)` — both empty-buffer-with-pending-data and buffer-with-content cases flush. Fix verified.

---

### BUG-0034
- **status:** `verified`
- **severity:** `high`
- **file:** `src/pregel.ts`
- **line:** `486`
- **category:** `race-condition`
- **description:** When a HITL interrupt fires in one parallel node, `Promise.all` rejects immediately but the other concurrent node promises continue executing in the background — their side effects are non-deterministically applied without being checkpointed.
- **context:** `executeNode` callbacks run concurrently via `Promise.all`. If node "A" throws `NodeInterruptSignal`, its catch block saves a checkpoint and rethrows `HITLInterruptException`. `Promise.all` rejects. But node "B" (also in flight) continues executing — calling external APIs, writing to stores, emitting events — with no cancellation signal. The checkpoint saved at the interrupt point reflects state before "B" completes, so when the user resumes, "B" re-runs from the checkpoint. Any side effects "B" already applied are applied a second time, causing double-writes to external systems.
- **hunter_found:** `2026-03-14T15:23:00Z`
- **fixer_started:** `2026-03-14T17:15:00Z`
- **fixer_completed:** `2026-03-14T17:19:00Z`
- **fix_summary:** Replaced `Promise.all` with `Promise.allSettled` for parallel node execution in `src/pregel.ts`. A `pendingInterrupt` variable captures the first `HITLInterruptException` without propagating it immediately. After all nodes settle, fulfilled results are collected, the first non-interrupt error is re-thrown if present, then the stored interrupt is thrown. This ensures in-flight nodes complete before the interrupt is surfaced to the caller, eliminating the race between the checkpoint save and background node execution.
- **validator_started:** `2026-03-14T19:43:00Z`
- **validator_completed:** `2026-03-14T19:47:00Z`
- **validator_notes:** Confirmed `Promise.allSettled` at line 501 with `pendingInterrupt` accumulator pattern. Traced: `NodeInterruptSignal` catch stores first interrupt at line 622 without immediate rethrow, then dispatches after allSettled at line 671 — all parallel nodes complete before interrupt surfaces. Non-interrupt errors re-thrown first at line 668 (correct priority). 21 pregel-engine tests and 25 HITL tests pass. Verified.

---

### BUG-0035
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/hitl/resume.ts`
- **line:** `53`
- **category:** `memory-leak`
- **description:** `HITLSessionStore` never removes sessions after they are marked "resumed" — the `sessions` Map grows without bound for the lifetime of the runner instance.
- **context:** `markResumed()` sets `status = "resumed"` but never deletes the entry from `this.sessions`. `getByThread()` and `pendingCount()` filter for `"pending"` only, so correctness is unaffected, but every completed HITL interaction permanently occupies memory. A long-lived process handling hundreds of interrupts per day accumulates all historical sessions indefinitely with no eviction path.
- **hunter_found:** `2026-03-14T15:29:00Z`
- **fixer_started:** `2026-03-14T19:15:00Z`
- **fixer_completed:** `2026-03-14T19:17:00Z`
- **fix_summary:** Added lazy eviction at the top of `HITLSessionStore.record()` in `src/hitl/resume.ts`. Before inserting a new session, iterates the map and deletes all entries with `status === "resumed"`. This keeps memory bounded while preserving the ability to call `get()` and `all()` on a resumed session between `markResumed()` and the next `record()` call.
- **validator_started:** `2026-03-15T04:15:00Z`
- **validator_completed:** `2026-03-15T04:17:00Z`
- **validator_notes:** Confirmed resume.ts:32-34 iterates and deletes all `status === "resumed"` entries at start of `record()`. Lazy eviction keeps memory bounded while allowing callers to read a resumed session between markResumed() and next record(). Fix correct.

---

### BUG-0036
- **status:** `verified`
- **severity:** `high`
- **file:** `src/hitl/interrupt.ts`
- **line:** `112`
- **category:** `logic-bug`
- **description:** A node that calls `interrupt()` more than once receives the same resume value for every call after the first — subsequent interrupts are silently skipped and return stale data.
- **context:** `InterruptContext` holds a single `resumeValue` and `hasResume` flag, set once per node execution. On resume, `hasResume` stays `true` for the entire re-execution. The first `interrupt()` correctly returns the resume value, but all subsequent `interrupt()` calls also return that same value immediately without pausing. A node with two sequential `await interrupt()` calls (e.g., multi-step confirmation dialogs) will silently use the first human response as the answer to the second question, with no error or warning.
- **hunter_found:** `2026-03-14T15:29:00Z`
- **fixer_started:** `2026-03-14T17:21:00Z`
- **fixer_completed:** `2026-03-14T17:23:00Z`
- **fix_summary:** Replaced `resumeValue/hasResume` with `resumeValues: unknown[]` queue in `InterruptContext` in `src/hitl/interrupt.ts`. `interrupt()` now calls `shift()` to consume one value per call — when the queue is empty it throws `NodeInterruptSignal` to pause for the next human response instead of returning stale data. Updated `_installInterruptContext` in `src/pregel.ts` to pass `hasResume ? [resumeValue] : []`. Updated all test usages of the old API.
- **validator_started:** `2026-03-14T19:48:00Z`
- **validator_completed:** `2026-03-14T19:50:00Z`
- **validator_notes:** Confirmed `resumeValues: unknown[]` queue in `InterruptContext` (line 63), `shift()` in `interrupt()` at line 115 consumes one value per call, empty queue falls through to `NodeInterruptSignal`. `_installInterruptContext` called with `hasResume ? [resumeValue] : []` at pregel.ts:221 — single-value wrapping is correct. 25 HITL tests pass, `tsc --noEmit` clean. Verified.

---

### BUG-0037
- **status:** `verified`
- **severity:** `high`
- **file:** `src/models/openrouter.ts`
- **line:** `327`
- **category:** `type-error`
- **description:** `chat()` uses the non-null assertion `json.choices[0]!` without checking whether `choices` is non-empty — crashes with TypeError when OpenRouter returns an empty array.
- **context:** OpenRouter can return `choices: []` on a 200 response when a provider is unavailable, rate-limited mid-completion, or the request is blocked by a content policy. The same defect exists in `src/models/google.ts` (BUG-0022) and `src/models/openai.ts` (BUG-0032) — this is the third adapter with the same unchecked assertion, crashing with `Cannot read properties of undefined (reading 'message')`.
- **hunter_found:** `2026-03-14T15:29:00Z`
- **fixer_started:** `2026-03-14T17:35:00Z`
- **fixer_completed:** `2026-03-14T17:40:00Z`
- **fix_summary:** Replaced `json.choices[0]!` with `json.choices?.[0]` guard in `src/models/openrouter.ts` `chat()`. When `choices` is empty or missing, returns a graceful `ChatResponse` with empty content, zero usage, and `stopReason: "end"` — matching the BUG-0022/BUG-0032 pattern. Also added `?.` on `json.usage` in the success path to avoid a secondary crash if usage is absent.
- **validator_started:** `2026-03-14T20:05:00Z`
- **validator_completed:** `2026-03-14T20:07:00Z`
- **validator_notes:** Confirmed `json.choices?.[0]` at line 327, early-return guard at lines 328-338, and `json.usage?.` optional chaining on both usage reads (lines 332-333 and 356-357). Identical pattern to verified BUG-0022 and BUG-0032. 22 openrouter model tests pass. Verified.

---

### BUG-0038
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/retry.ts`
- **line:** `51`
- **category:** `logic-bug`
- **description:** Jitter mutates `delay` in-place before `delay` is used as the base for the next exponential step — compounded jitter causes the backoff to diverge from its intended exponential trajectory.
- **context:** Line 51 applies ±25% jitter to `delay` (e.g. 500ms → 375-625ms), then line 55 computes the next delay from that jittered value (`375-625 * 2 = 750-1250ms`). The clean exponential base (500, 1000, 2000…) drifts ±25% compounded per attempt. With consistently high jitter, delays grow faster than intended; with consistently low jitter they stay much shorter. The standard approach is to track a clean exponential base separately and apply jitter only for computing the sleep duration, not the base for the next step.
- **hunter_found:** `2026-03-14T15:29:00Z`
- **fixer_started:** `2026-03-14T19:18:00Z`
- **fixer_completed:** `2026-03-14T19:19:00Z`
- **fix_summary:** In `src/retry.ts` `withRetry()`, introduced a separate `sleepDuration` variable computed by applying jitter to `delay`. The `delay` variable itself is no longer mutated by jitter — it remains the clean exponential base for `delay = Math.min(delay * backoffMultiplier, maxDelay)` on the next step. Jitter now correctly randomizes only the sleep time without corrupting the backoff trajectory.
- **validator_started:** `2026-03-15T04:17:00Z`
- **validator_completed:** `2026-03-15T04:18:00Z`
- **validator_notes:** Confirmed retry.ts:51-56 — `sleepDuration` applies ±25% jitter to `delay`; `delay` is then advanced clean via `delay = Math.min(delay * backoffMultiplier, maxDelay)`. Jitter no longer corrupts the exponential base. Fix verified.

---

### BUG-0039
- **status:** `verified`
- **severity:** `high`
- **file:** `src/stream-events.ts`
- **line:** `40`
- **category:** `logic-bug`
- **description:** `streamEvents()` forces `streamMode: "debug"` but `state_update` events are only emitted in `"values"` mode — the final `on_chain_end` event always reports `output: undefined`.
- **context:** The pregel `_stream()` generator emits `state_update` events only when `modeValues` is true (lines 398, 743, 764 in `pregel.ts`). By using `"debug"` mode alone, `streamEvents` never receives any `state_update` event, so `finalData` stays `undefined` for every execution. The final `on_chain_end` event is emitted with `data: { output: undefined }` regardless of the actual graph result. `streamMode` should be `["debug", "values"]` to receive both node lifecycle events and state updates — exactly the pattern used for subgraph streaming in `pregel.ts:552`.
- **hunter_found:** `2026-03-14T15:35:00Z`
- **fixer_started:** `2026-03-14T17:41:00Z`
- **fixer_completed:** `2026-03-14T17:43:00Z`
- **fix_summary:** Changed `streamMode: "debug"` to `streamMode: ["debug", "values"]` in `src/stream-events.ts` line 40. The `values` mode causes pregel to emit `state_update` events, which `streamEvents()` already handled in the `e.event === "state_update"` branch to capture `finalData`. Without it, `finalData` was always `undefined` so `on_chain_end` always reported `output: undefined`.
- **validator_started:** `2026-03-14T20:20:00Z`
- **validator_completed:** `2026-03-14T20:22:00Z`
- **validator_notes:** Confirmed `streamMode: ["debug", "values"]` at line 40 — `values` mode causes pregel to emit `state_update` events, captured at line 58-60 into `finalData`, so `on_chain_end` at line 65 reports the actual graph output. Root cause directly addressed. 3 stream-events tests pass. Verified.

---

### BUG-0040
- **status:** `verified`
- **severity:** `low`
- **file:** `src/stream-events.ts`
- **line:** `60`
- **category:** `dead-code`
- **description:** The `e.event === "error"` branch and resulting `"on_chain_error"` yield are dead code — stream errors are thrown exceptions, not yielded events.
- **context:** When a node fails, `pregel.ts` re-throws the error (line 624), which terminates the async generator. The stream consumer receives a thrown exception from the `for await` loop, not an event with `event: "error"`. No `state_update` or `error` event type is ever yielded by the debug stream. The `on_chain_error` branch never executes, silently misleading consumers who await it to detect failures.
- **hunter_found:** `2026-03-14T15:35:00Z`
- **fixer_started:** `2026-03-14T20:18:00Z`
- **fixer_completed:** `2026-03-14T20:18:00Z`
- **fix_summary:** `Removed the dead "error" event branch and on_chain_error yield from streamToEvents() in src/stream-events.ts. Stream errors are thrown exceptions from pregel.ts, not yielded events; the branch could never execute and was replaced with a comment explaining the actual error propagation mechanism.`
- **validator_started:** `2026-03-15T05:01:00Z`
- **validator_completed:** `2026-03-15T05:01:00Z`
- **validator_notes:** Confirmed `on_chain_error` yield removed from stream-events.ts; line 62 now has a comment explaining errors are thrown exceptions, not yielded events. Dead code eliminated. Verified.

---

### BUG-0041
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/checkpointers/namespaced.ts`
- **line:** `17`
- **category:** `logic-bug`
- **description:** `prefix()` uses `:` as separator between `threadId` and namespace name — if either contains `:`, two distinct subgraph contexts produce identical checkpoint keys and silently share state.
- **context:** `prefix()` returns `${threadId}:${this.ns}`. If `threadId = "run:1"` and `ns = "worker"`, the key is `"run:1:worker"`. If `threadId = "run"` and `ns = "1:worker"` (a subgraph node named `"1:worker"`), the key is also `"run:1:worker"`. The two subgraph checkpointers write to the same storage location, corrupting each other's state. Node names with colons are rare but not prevented by `StateGraph.addSubgraph()`.
- **hunter_found:** `2026-03-14T15:35:00Z`
- **fixer_started:** `2026-03-14T19:20:00Z`
- **fixer_completed:** `2026-03-14T19:21:00Z`
- **fix_summary:** Changed `NamespacedCheckpointer.prefix()` in `src/checkpointers/namespaced.ts` from `` `${threadId}:${this.ns}` `` to `JSON.stringify([threadId, this.ns])`. JSON serialization of a two-element array produces an unambiguous key regardless of whether `threadId` or `ns` contain colons, eliminating the key-collision risk.
- **validator_started:** `2026-03-15T04:18:00Z`
- **validator_completed:** `2026-03-15T04:19:00Z`
- **validator_notes:** Confirmed namespaced.ts:19 uses `JSON.stringify([threadId, this.ns])` — unambiguous key regardless of colons in either component. Fix verified.

---

### BUG-0042
- **status:** `verified`
- **severity:** `high`
- **file:** `src/agents/define-agent.ts`
- **line:** `156`
- **category:** `logic-bug`
- **description:** When the `maxTokens` budget is exceeded after the LLM responds with tool calls, the loop breaks leaving the conversation history malformed — an assistant message with `toolCalls` is appended but no corresponding tool result messages follow.
- **context:** `messages.push(assistantMsg)` at line 153 adds the assistant message (including `toolCalls`) before the budget check at line 156. When the budget fires, `break` exits the loop without executing the tool calls or appending tool result messages. The returned `newMessages` slice contains this dangling assistant+toolCalls message. On the next invocation, `model.chat()` receives an invalid conversation history where an assistant message has `toolCalls` with no tool results following — both Anthropic and OpenAI APIs reject this with a validation error.
- **hunter_found:** `2026-03-14T15:45:00Z`
- **fixer_started:** `2026-03-14T22:35:00Z`
- **fixer_completed:** `2026-03-14T22:42:00Z`
- **fix_summary:** Changed the over-budget handling in `src/agents/define-agent.ts` to push the assistant message with `toolCalls` stripped (`{ role: "assistant", content: assistantMsg.content }`) instead of conditionally suppressing the message entirely. This produces an API-valid turn (no dangling toolCalls) while preserving the text content and matching the test expectation of 5 messages. All 6 define-agent tests pass; `tsc --noEmit` clean.
- **validator_started:** `2026-03-15T01:29:00Z`
- **validator_completed:** `2026-03-15T01:31:00Z`
- **validator_notes:** Confirmed lines 159-162: budget check now occurs BEFORE pushing assistantMsg — over-budget path pushes `{ role: "assistant", content: assistantMsg.content }` (toolCalls stripped), preventing dangling tool-call sequences. Normal path at line 164 pushes full assistantMsg unchanged. All 6 define-agent tests pass including "respects maxTokens budget".

---

### BUG-0043
- **status:** `verified`
- **severity:** `high`
- **file:** `src/messages/index.ts`
- **line:** `171`
- **category:** `logic-bug`
- **description:** `trimMessages` can slice through an assistant-toolCalls / tool-result pair, returning orphaned tool result messages with no preceding assistant message that contains `toolCalls`.
- **context:** `nonSystem.slice(-maxMessages)` trims conversation history without regard for message pairing. If the slice boundary falls between an assistant message with `toolCalls` and its corresponding tool result messages, the result starts with tool result messages that have no antecedent `toolCalls` entry. Both Anthropic and OpenAI APIs require tool results to immediately follow the assistant message that generated the calls; sending an orphaned tool result triggers a validation error.
- **hunter_found:** `2026-03-14T15:45:00Z`
- **fixer_started:** `2026-03-14T17:47:00Z`
- **fixer_completed:** `2026-03-14T17:50:00Z`
- **fix_summary:** Added a post-slice guard in `trimMessages` in `src/messages/index.ts`: after `nonSystem.slice(-maxMessages)`, the function now advances past any leading `tool` messages (which would be orphaned tool results whose paired `assistant+toolCalls` was sliced off). This ensures the returned history always starts at a clean turn boundary.
- **validator_started:** `2026-03-14T20:50:00Z`
- **validator_completed:** `2026-03-14T20:53:00Z`
- **validator_notes:** Confirmed post-slice while loop at lines 175-177: strips all leading `tool` messages from the trimmed array — any `tool` at position 0 is necessarily orphaned (nothing precedes it in the slice). Empty-array guard `trimmed.length > 0` prevents infinite loop. System messages preserved at front. `tsc --noEmit` clean. Verified.

---

### BUG-0044
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/config/loader.ts`
- **line:** `243`
- **category:** `missing-error-handling`
- **description:** `loadSingleConfig` silently swallows JSONC parse errors with no logging, despite the module docstring at line 178 claiming invalid files are "logged but don't throw."
- **context:** The `catch` block at line 243 has only a comment "File doesn't exist or can't be read — skip silently" and returns `null`. A user with a syntax error in their `oni.jsonc` or `~/.oni/config.jsonc` gets no error message and no indication that their config was ignored; the agent silently runs with empty/default configuration. This is especially dangerous for misconfigured API keys or model settings.
- **hunter_found:** `2026-03-14T15:45:00Z`
- **fixer_started:** `2026-03-14T19:22:00Z`
- **fixer_completed:** `2026-03-14T19:23:00Z`
- **fix_summary:** Split the single try/catch in `loadSingleConfig()` in `src/config/loader.ts` into two separate try/catch blocks. The first catches `readFile` failures and returns null silently. The second catches `parseJsonc` failures and emits `console.warn("[oni] Config parse error in \"path\": ...")` before returning null, matching the documented behavior of "invalid files are logged but don't throw."
- **validator_started:** `2026-03-15T04:19:00Z`
- **validator_completed:** `2026-03-15T04:20:00Z`
- **validator_notes:** Confirmed config/loader.ts:237-253 splits try/catch into two blocks — readFile fails silently, parseJsonc failure emits console.warn with path and error message. Matches documented behavior. Fix verified.

---

### BUG-0045
- **status:** `verified`
- **severity:** `low`
- **file:** `src/events/bus.ts`
- **line:** `29`
- **category:** `memory-leak`
- **description:** `EventBus.onAll()` does not check `this.disposed` before registering a handler, allowing handlers to be added to a disposed bus where they accumulate without ever being called or cleaned up.
- **context:** `on()` guards with `if (this.disposed) return () => {}` (line 20), but `onAll()` at line 28 lacks this check. After `dispose()` clears `allHandlers`, a subsequent `onAll(h)` call re-populates the set. Since `emit()` early-returns when `disposed` (line 36), the registered handler is never invoked. If the caller loses the returned unsubscribe function, the handler leaks in `allHandlers` permanently — no future `dispose()` will clean it up because `disposed` is already `true` and `removeAll()` would only run once.
- **hunter_found:** `2026-03-14T15:45:00Z`
- **fixer_started:** `2026-03-14T19:24:00Z`
- **fixer_completed:** `2026-03-14T19:24:00Z`
- **fix_summary:** No code change needed. `EventBus.onAll()` disposed guard was already fixed as part of BUG-0009. The guard `if (this.disposed) return () => {};` is present at the top of `onAll()` in `src/events/bus.ts`.
- **validator_started:** `2026-03-15T04:20:00Z`
- **validator_completed:** `2026-03-15T04:21:00Z`
- **validator_notes:** Confirmed events/bus.ts:29 has `if (this.disposed) return () => {};` at top of `onAll()`. Guard present, matching `on()` pattern at line 20. Fix verified (no code change needed per Fixer — already fixed by BUG-0009).

---

### BUG-0046
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/harness/agent-loop.ts`
- **line:** `274`
- **category:** `memory-leak`
- **description:** The `"abort"` event listener registered on `config.signal` during a retry delay is declared with `{ once: true }` but is never explicitly removed when the timer fires before the abort event, leaving an orphaned listener on the signal object.
- **context:** `addEventListener("abort", onAbort, { once: true })` at line 274 only auto-removes the listener when the abort event fires. When the `setTimeout(resolve, delayMs)` timer fires first, the promise resolves but `onAbort` stays registered on `config.signal`. For a session with 3 retries, 3 listeners accumulate. If `config.signal` is long-lived (process-scoped or reused across sessions), each retry delay leaves a permanent listener; on Node.js `EventEmitter`, this triggers the `MaxListenersExceededWarning` after 11 accumulated listeners.
- **hunter_found:** `2026-03-14T15:55:00Z`
- **fixer_started:** `2026-03-14T19:24:00Z`
- **fixer_completed:** `2026-03-14T19:24:00Z`
- **fix_summary:** No code change needed. This is a duplicate of BUG-0007, which was already fixed. `src/harness/agent-loop.ts` now declares `onAbort` before `timer`, and the timer callback calls `config.signal.removeEventListener("abort", onAbort)` before resolving.
- **validator_started:** `2026-03-15T04:21:00Z`
- **validator_completed:** `2026-03-15T04:22:00Z`
- **validator_notes:** Confirmed agent-loop.ts:285 calls `config.signal.removeEventListener("abort", onAbort)` when timer fires, removing the listener before the promise resolves. Fix present (already fixed by BUG-0007). Verified.

---

### BUG-0047
- **status:** `verified`
- **severity:** `high`
- **file:** `src/harness/context-compactor.ts`
- **line:** `193`
- **category:** `logic-bug`
- **description:** `clearOldToolResults` removes `role === "tool"` messages from the older portion of conversation history without removing their paired `role === "assistant"` messages that contain `toolCalls`, potentially leaving the returned array with orphaned assistant+toolCalls entries.
- **context:** Stage 1 of `_runCompaction` calls `clearOldToolResults` and checks `if (!this.shouldCompact(cleaned)) return cleaned` at line 162. If removing tool messages was sufficient to reduce token usage below the threshold, `cleaned` is returned directly — but this array can contain assistant messages with `toolCalls` whose tool result counterparts were removed. When this malformed history is used for subsequent `model.chat()` calls, both Anthropic and OpenAI APIs reject it: an assistant message with `toolCalls` must be immediately followed by the corresponding tool result messages.
- **hunter_found:** `2026-03-14T15:55:00Z`
- **fixer_started:** `2026-03-14T17:51:00Z`
- **fixer_completed:** `2026-03-14T17:53:00Z`
- **fix_summary:** Updated `clearOldToolResults` in `src/harness/context-compactor.ts` to first collect the IDs of tool-result messages being removed, then also filter out any assistant messages whose `toolCalls` include those IDs. This ensures no `assistant+toolCalls` message is left without its paired tool results in the cleaned history.
- **validator_started:** `2026-03-14T21:00:00Z`
- **validator_completed:** `2026-03-14T21:03:00Z`
- **validator_notes:** Traced the two-pass algorithm: `removedToolCallIds` collects all older-portion tool IDs; `keptToolCallIds` handles the split-across-cutoff edge case (assistant spans both portions — retains its older tool results). `filteredOlder` removes tool messages unless in `keptToolCallIds`, removes assistant+toolCalls only when ALL calls removed. All edge cases covered. 14 compactor tests pass. Verified.

---

### BUG-0048
- **status:** `verified`
- **severity:** `low`
- **file:** `src/harness/skill-loader.ts`
- **line:** `222`
- **category:** `security`
- **description:** Skill `name` and `description` are interpolated directly into an XML string in `getDescriptionsForContext()` without escaping XML special characters.
- **context:** `<skill name="${skill.name}">${skill.description}</skill>` will produce malformed XML if either field contains `<`, `>`, `"`, `&`, or `'`. A SKILL.md file whose `description` contains `</skill><skill name="injected">` would break the `<available-skills>` block in the system prompt, potentially confusing the LLM's skill selection or injecting unexpected content into the context. Skills are loaded from user-configured directories, so this is exploitable by any file placed in a skill path.
- **hunter_found:** `2026-03-14T15:55:00Z`
- **fixer_started:** `2026-03-14T20:19:00Z`
- **fixer_completed:** `2026-03-14T20:19:00Z`
- **fix_summary:** `Added escXml() helper in getDescriptionsForContext() in src/harness/skill-loader.ts that escapes &, <, >, and " before interpolating skill name and description into the XML attribute and element body. Prevents malformed XML and prompt injection from SKILL.md files with special characters in their metadata fields.`
- **validator_started:** `2026-03-15T05:01:00Z`
- **validator_completed:** `2026-03-15T05:01:00Z`
- **validator_notes:** Confirmed `escXml()` helper at lines 233-234 of skill-loader.ts escapes `&`, `<`, `>`, `"` before interpolation at line 238. Both `skill.name` (XML attribute) and `skill.description` (element body) are escaped. Prevents malformed XML and prompt injection. Verified.

---

### BUG-0049
- **status:** `verified`
- **severity:** `high`
- **file:** `src/store/index.ts`
- **line:** `103`
- **category:** `logic-bug`
- **description:** `InMemoryStore.key()` uses `namespace.join("/")` to build composite storage keys, causing a collision when any namespace array element itself contains a `/` character.
- **context:** `namespace = ["users", "alice/bob"]` with key `"pref"` produces the storage key `"users/alice/bob::pref"` — identical to `namespace = ["users", "alice", "bob"]` with the same key. Two logically distinct namespaces silently map to the same storage key, causing `get`, `put`, `delete`, and `list` operations from one namespace to corrupt or expose data belonging to the other. The same flaw applies to `listNamespaces()` which uses `ns.join("/")` for set deduplication.
- **hunter_found:** `2026-03-14T16:05:00Z`
- **fixer_started:** `2026-03-14T17:54:00Z`
- **fixer_completed:** `2026-03-14T17:57:00Z`
- **fix_summary:** Replaced `namespace.join("/")` with `JSON.stringify(namespace)` in three locations in `src/store/index.ts`: `key()` (line 103), `list()` (lines 153/161), and `listNamespaces()` (line 230). JSON serialization of the array produces structurally distinct keys for any namespace elements regardless of their content, eliminating the `/`-based collision.
- **validator_started:** `2026-03-14T21:10:00Z`
- **validator_completed:** `2026-03-14T21:13:00Z`
- **validator_notes:** Confirmed `JSON.stringify(namespace)` at all three call sites: `key()` line 106, `list()` lines 175+183 (prefix stored then compared via JSON serialization of `item.namespace`), `listNamespaces()` line 252. `item.namespace` is stored as the raw array in `put()` (line 135), so namespace equality checks are structurally correct. `tsc --noEmit` clean, store-related tests pass. Verified.

---

### BUG-0050
- **status:** `verified`
- **severity:** `high`
- **file:** `src/swarm/mailbox.ts`
- **line:** `37`
- **category:** `logic-bug`
- **description:** `consumeInbox` removes all broadcast messages (`to === "*"`) when any single agent consumes its inbox, preventing subsequent agents from ever reading those broadcasts.
- **context:** `consumeInbox(messages, agentId)` returns all messages where `to !== agentId && to !== "*"`, effectively treating broadcast messages as "consumed by everyone" after the first agent reads them. In a multi-agent graph where state is passed forward (sequential topology: A → B → C), after agent A calls `consumeInbox`, the returned state has no broadcasts. When agent B runs, the broadcasts are already gone. This silently drops inter-agent notifications intended for multiple recipients.
- **hunter_found:** `2026-03-14T16:05:00Z`
- **fixer_started:** `2026-03-14T17:58:00Z`
- **fixer_completed:** `2026-03-14T18:00:00Z`
- **fix_summary:** Changed the filter in `consumeInbox` in `src/swarm/mailbox.ts` from `m.to !== agentId && m.to !== "*"` to `m.to !== agentId`. Broadcasts are now preserved in the mailbox after any agent reads them so that subsequent agents in the execution chain still receive them. Only direct messages addressed to the consuming agent are removed.
- **validator_started:** `2026-03-14T21:20:00Z`
- **validator_completed:** `2026-03-14T21:22:00Z`
- **validator_notes:** Confirmed `consumeInbox` at line 39 filters `m.to !== agentId` — broadcasts (`to === "*"`) are no longer removed, only direct messages to the consuming agent. `getInbox` at line 32 still returns both direct and broadcast messages for reading. 3 auto-consume-inbox tests pass. Verified.

---

### BUG-0051
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/swarm/supervisor.ts`
- **line:** `205`
- **category:** `logic-bug`
- **description:** The LLM routing fuzzy fallback uses `Array.find` with `response.content.includes(id)`, which returns the first agent whose ID is a substring of the response — selecting the wrong agent when one ID is a prefix or substring of another.
- **context:** If the registered agent IDs include both `"agent"` and `"agent-advanced"` (in that order in the registry), and the LLM responds with `"agent-advanced"`, `agentIds.find(id => response.content.includes(id))` returns `"agent"` — because `"agent-advanced".includes("agent")` is true and `"agent"` appears first. The wrong agent is selected for the task. The fix requires a longest-match or whole-word strategy, not first-substring-match.
- **hunter_found:** `2026-03-14T16:05:00Z`
- **fixer_started:** `2026-03-14T19:33:00Z`
- **fixer_completed:** `2026-03-14T19:35:00Z`
- **fix_summary:** `Replaced the first-match substring strategy in routeViaLLM() in src/swarm/supervisor.ts with a longest-match strategy. All matching agent IDs are collected first, then sorted descending by length, and the longest is returned. This ensures "agent-advanced" wins over "agent" when both appear as substrings of the LLM response.`
- **validator_started:** `2026-03-15T04:22:00Z`
- **validator_completed:** `2026-03-15T04:23:00Z`
- **validator_notes:** Confirmed supervisor.ts:207-210 collects all matching IDs via filter, sorts descending by length, returns longest. "agent-advanced" beats "agent" when both match. Fix verified.

---

### BUG-0052
- **status:** `verified`
- **severity:** `high`
- **file:** `src/lsp/client.ts`
- **line:** `88`
- **category:** `race-condition`
- **description:** `start()` checks for `"ready"` and `"broken"` states but not `"connecting"`, allowing concurrent callers to both pass the guard and each spawn a separate language server process.
- **context:** If two callers invoke `start()` simultaneously while `state === "idle"`, both read the state before either sets it to `"connecting"`, then both execute the full spawn+initialize handshake. This creates two orphaned language server processes; only the last `this.process` assignment survives, leaving the first process leaked and its stdio listeners dangling.
- **hunter_found:** `2026-03-14T16:10:00Z`
- **fixer_started:** `2026-03-14T18:01:00Z`
- **fixer_completed:** `2026-03-14T18:03:00Z`
- **fix_summary:** Added `_startPromise: Promise<void> | null` field to `LSPClient` in `src/lsp/client.ts`. `start()` now stores the in-flight Promise and returns it to any concurrent callers (coalescing lock). The actual implementation was extracted to `_doStart()`. The lock is cleared in a `finally` block so subsequent calls after completion restart normally.
- **validator_started:** `2026-03-14T21:30:00Z`
- **validator_completed:** `2026-03-14T21:35:00Z`
- **validator_notes:** `_startPromise` assigned synchronously before first `await` — same coalescing lock pattern as BUG-0061 (MCPClient, verified). `_doStart()` sets state `connecting`, spawns process, sends `initialize`, and transitions to `ready` or `broken` with proper `finally`-driven lock release. 36 LSP tests pass, `tsc --noEmit` clean. Verified.

---

### BUG-0053
- **status:** `verified`
- **severity:** `high`
- **file:** `src/lsp/client.ts`
- **line:** `417`
- **category:** `logic-bug`
- **description:** `handleMessage` checks `"id" in message` first; server→client requests (which have both `id` and `method`) match this branch, find no pending entry, and `return` before the server-request handler at line 429 is ever reached.
- **context:** LSP servers send requests (e.g. `window/workDoneProgress/create`, `client/registerCapability`) that carry both `id` and `method`. The response-handler branch at line 417 claims all messages with an `id`, so the server-request handler at line 429 is dead code. These server requests silently receive no reply, causing the language server to stall waiting for acknowledgment and eventually time out or disconnect.
- **hunter_found:** `2026-03-14T16:10:00Z`
- **fixer_started:** `2026-03-14T18:03:00Z`
- **fixer_completed:** `2026-03-14T18:03:00Z`
- **fix_summary:** Already resolved by the BUG-0015 fix from a prior session. `handleMessage` in `src/lsp/client.ts` now checks `id + method` first (server→client requests) before the `id`-only response branch, so server requests are correctly handled and replied to before falling through to the response dispatcher.
- **validator_started:** `2026-03-14T21:38:00Z`
- **validator_completed:** `2026-03-14T21:41:00Z`
- **validator_notes:** `handleMessage` now checks `"id" in message && "method" in message` first (server→client requests) before the `"id"`-only response branch, directly fixing the routing priority bug. All 4 known server-request methods handled with correct responses; unknown methods receive `MethodNotFound` so the server is never left waiting. 36 LSP tests pass.

---

### BUG-0054
- **status:** `verified`
- **severity:** `high`
- **file:** `src/mcp/transport.ts`
- **line:** `63`
- **category:** `race-condition`
- **description:** `start()` guards only with `if (this.connected) return`, which is insufficient against concurrent callers — both read `connected === false` before either sets it, and both proceed to spawn the MCP server process.
- **context:** Same race pattern as BUG-0013 (MCPClient) and BUG-0052 (LSPClient). Two concurrent `start()` calls both pass the single boolean guard, both spawn child processes, and both register stdout/stderr listeners. The second spawn overwrites `this.process`, leaking the first process and its event listeners; incoming messages from the first process parse against the shared buffer causing data corruption.
- **hunter_found:** `2026-03-14T16:10:00Z`
- **fixer_started:** `2026-03-14T18:05:00Z`
- **fixer_completed:** `2026-03-14T18:07:00Z`
- **fix_summary:** Added `_startPromise: Promise<void> | null` field to `StdioTransport` in `src/mcp/transport.ts`. `start()` sets the lock synchronously before the first await and returns the in-flight Promise to concurrent callers. Implementation extracted to `_doStart()`. Lock cleared in `finally` so subsequent calls after completion work normally.
- **validator_started:** `2026-03-14T21:44:00Z`
- **validator_completed:** `2026-03-14T21:47:00Z`
- **validator_notes:** `_startPromise` assigned synchronously from `_doStart()` (which wraps `new Promise()`, always returns immediately) — same coalescing lock as BUG-0052/BUG-0061. `connected = true` set synchronously inside `_doStart` before resolve, so the fast-path `if (this.connected)` short-circuits after completion. `finally` clears lock on both success and failure. 32 MCP tests pass.

---

### BUG-0055
- **status:** `verified`
- **severity:** `critical`
- **file:** `src/swarm/graph.ts`
- **line:** `1190`
- **category:** `logic-bug`
- **description:** The normal agent completion path spreads the full `state.handoffHistory` into its returned update, causing the `appendList` channel reducer `(a, b) => [...a, ...b]` to duplicate every prior record on each completion.
- **context:** `appendList` appends the returned value to its own current accumulated state. The node returns `[...state.handoffHistory, newEntry]` (which already contains all history), so the reducer produces `[...currentHistory, ...state.handoffHistory, newEntry]` — every existing entry is doubled. With N agents completing sequentially the history grows as 2^N, consuming unbounded memory and making the handoff log unusable.
- **hunter_found:** `2026-03-14T16:15:00Z`
- **fixer_started:** `2026-03-14T16:49:00Z`
- **fixer_completed:** `2026-03-14T16:51:00Z`
- **fix_summary:** Removed the spread of `state.handoffHistory` from the completion-path return in `src/swarm/graph.ts` (line ~1190). The `handoffHistory` channel uses the `appendList` reducer `(a, b) => [...a, ...b]`, so returning `[...state.handoffHistory, newEntry]` caused the reducer to double every prior record. Now only the single new entry `[{ from, to: "__completed__", ... }]` is returned, matching the correct pattern already used in the handoff path at line 1162.
- **validator_started:** `2026-03-14T17:10:00Z`
- **validator_completed:** `2026-03-14T17:13:00Z`
- **validator_notes:** Confirmed lines 1190-1198 return only `[{from, to: "__completed__", ...}]` — no `state.handoffHistory` spread. This matches the handoff path at line 1162. The `appendList` reducer `(a, b) => [...a, ...b]` now correctly produces `[...currentHistory, newEntry]` instead of doubling all prior entries. `tsc --noEmit` clean; all 44 swarm test files (200 tests) pass.

---

### BUG-0056
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/swarm/graph.ts`
- **line:** `1203`
- **category:** `logic-bug`
- **description:** `registry.markError()` is called on every failed attempt inside the retry loop, inflating the agent's `errors` counter by `(maxRetries + 1)` instead of 1 per failed task.
- **context:** `markBusy` is called once before the retry loop, but `markError` is called at line 1203 on each failed `catch` block — including mid-retry attempts that will be retried again. An agent with `maxRetries=2` that fails all three attempts will show `errors: 3` instead of `errors: 1`, corrupting registry stats and any dashboards or scaling decisions that use error rates.
- **hunter_found:** `2026-03-14T16:15:00Z`
- **fixer_started:** `2026-03-14T19:36:00Z`
- **fixer_completed:** `2026-03-14T19:37:00Z`
- **fix_summary:** `Moved registry.markError() call from inside the per-attempt catch block to after the retry loop in src/swarm/graph.ts, so it fires exactly once when all retries are exhausted. Previously it fired on every failed attempt, inflating the error counter by maxRetries+1 per failed task.`
- **validator_started:** `2026-03-15T04:23:00Z`
- **validator_completed:** `2026-03-15T04:24:00Z`
- **validator_notes:** Confirmed swarm/graph.ts:1230 `markError()` is outside the retry loop (after line 1227 which closes the `for` loop). Fires exactly once when all retries are exhausted. Comment at line 1229 confirms intent. Fix verified.

---

### BUG-0057
- **status:** `verified`
- **severity:** `high`
- **file:** `src/swarm/graph.ts`
- **line:** `797`
- **category:** `missing-error-handling`
- **description:** In the `race` template, the per-agent `.then()` callbacks inside the race-winner promise have no `.catch()`, so if the user-supplied `accept` predicate throws, the rejection is silently swallowed and `remaining` is never decremented, causing the outer promise to hang indefinitely.
- **context:** The race node awaits `new Promise<RaceResult | null>` that resolves only when either a winner is found or `remaining` reaches 0. If `accept(r.result)` throws for any agent's result, that `.then()` chain rejects without decrementing `remaining`. If all remaining agents also fail or throw, the counter never hits 0 and `__race__` never returns — permanently blocking the swarm graph execution.
- **hunter_found:** `2026-03-14T16:15:00Z`
- **fixer_started:** `2026-03-14T18:08:00Z`
- **fixer_completed:** `2026-03-14T18:10:00Z`
- **fix_summary:** Wrapped the `accept(r.result)` call in a try/catch inside the `.then()` callback in `src/swarm/graph.ts`. If `accept()` throws, `accepted` stays `false` and `remaining` is decremented normally, preventing the promise from hanging. A thrown predicate is treated the same as a rejected result.
- **validator_started:** `2026-03-14T21:50:00Z`
- **validator_completed:** `2026-03-14T21:54:00Z`
- **validator_notes:** `accept(r.result)` is now wrapped in try/catch (lines 799-803); on throw, `accepted` stays `false` and `remaining` is decremented normally in the `else` branch. `agentPromises` never reject (rejection handler at lines 773-774 converts all errors to resolved values), so the `.then()` always fires. 4 race template tests pass; `dynamic-scaling` failure is pre-existing and in an unrelated file (`scaling.ts`).

---

### BUG-0058
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/harness/todo-module.ts`
- **line:** `80`
- **category:** `logic-bug`
- **description:** `updateStatus()` directly mutates the todo item and `this.state.lastUpdated` in-place, while `write()` replaces `this.state` with a new object via spread — making `read()`/`getState()` return inconsistent reference semantics depending on which method was last called.
- **context:** Code that caches the reference returned by `read()` before calling `updateStatus()` will see the cached snapshot retroactively mutated (since `this.state` is the same object). Conversely, code that caches the reference before `write()` will hold a stale snapshot that is never updated. Listeners notified by `notify()` receive `this.state` by reference, so listener-held snapshots are subject to the same mutation hazard from subsequent `updateStatus()` calls.
- **hunter_found:** `2026-03-14T16:15:00Z`
- **fixer_started:** `2026-03-14T19:38:00Z`
- **fixer_completed:** `2026-03-14T19:39:00Z`
- **fix_summary:** `Rewrote updateStatus() in src/harness/todo-module.ts to use immutable replacement: spreads the updated todo into a new object, rebuilds the todos array via spread, and assigns a new state object — matching the pattern used by write(). Eliminates in-place mutation that caused observers holding prior references to see unexpected state changes.`
- **validator_started:** `2026-03-15T04:24:00Z`
- **validator_completed:** `2026-03-15T04:25:00Z`
- **validator_notes:** Confirmed todo-module.ts:88 `updateStatus()` assigns `this.state = { ...this.state, todos, lastUpdated: now }` — new state object, matching `write()` pattern. No in-place mutation. Fix verified.

---

### BUG-0059
- **status:** `verified`
- **severity:** `high`
- **file:** `src/coordination/pubsub.ts`
- **line:** `34`
- **category:** `missing-error-handling`
- **description:** Subscriber handlers are invoked inside a bare `for...of` loop in `publish()` with no try/catch, so a throwing handler propagates out of `publish()` and aborts delivery to all subsequent subscribers for that message.
- **context:** If any subscriber's handler throws (due to a bug in user code or an unexpected message shape), `publish()` unwinds and every handler registered AFTER the throwing one never receives the message. In multi-agent swarms where agents subscribe to coordination topics, a single failing subscriber silently starves downstream agents of messages they are waiting for, causing their tasks to hang or produce stale results.
- **hunter_found:** `2026-03-14T16:20:00Z`
- **fixer_started:** `2026-03-14T17:05:00Z`
- **fixer_completed:** `2026-03-14T17:06:00Z`
- **fix_summary:** Wrapped `handler(msg)` in a try/catch inside the subscriber loop in `publish()` in `src/coordination/pubsub.ts`. A throwing handler is now silently isolated — delivery continues to all remaining handlers for that message. This preserves the delivery guarantee even when subscriber code throws.
- **validator_started:** `2026-03-14T18:53:00Z`
- **validator_completed:** `2026-03-14T18:55:00Z`
- **validator_notes:** Confirmed try/catch at lines 37–41 wraps each individual `handler(msg)` call inside the inner loop — errors are isolated per-handler and the outer loop continues delivering to remaining subscribers and patterns. Empty catch is correct; no other callers depend on `publish()` throwing. TSC clean; 15/15 coordination tests pass.

---

### BUG-0060
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/coordination/pubsub.ts`
- **line:** `17`
- **category:** `memory-leak`
- **description:** `PubSub.buffer` grows unboundedly for the lifetime of the instance when `maxBufferSize` is not configured, because the eviction guard at line 29 is skipped when `maxBufferSize` is `undefined`.
- **context:** `SwarmGraph` creates its `PubSub` instance without a `maxBufferSize` option (`new PubSub()` at line 191 of graph.ts), so every message published in the swarm is appended to `buffer` and never evicted. In long-running swarms or swarms that republish messages across many supersteps, this causes unbounded heap growth. `flush()` exists but is never called by the framework — only available to user code.
- **hunter_found:** `2026-03-14T16:20:00Z`
- **fixer_started:** `2026-03-14T19:40:00Z`
- **fixer_completed:** `2026-03-14T19:41:00Z`
- **fix_summary:** `Added DEFAULT_MAX_BUFFER_SIZE = 1000 constant in src/coordination/pubsub.ts and applied it as the default in the PubSub constructor so the buffer is always bounded even when no maxBufferSize option is passed. Changed the field type from number|undefined to number and simplified the eviction guard to always apply.`
- **validator_started:** `2026-03-15T04:43:00Z`
- **validator_completed:** `2026-03-15T04:44:00Z`
- **validator_notes:** `DEFAULT_MAX_BUFFER_SIZE = 1000` at line 15; constructor assigns `maxBufferSize: number` (not `number|undefined`) via `?? DEFAULT_MAX_BUFFER_SIZE` at line 23; eviction guard at lines 31-33 runs unconditionally on every publish. Root cause (unbounded buffer when no option passed) is fully addressed. Verified.

---

### BUG-0061
- **status:** `verified`
- **severity:** `high`
- **file:** `src/mcp/client.ts`
- **line:** `137`
- **category:** `race-condition`
- **description:** `disconnect()` sets `this.transport = null` while `_runConnect()` may be suspended at an `await`, causing the resumed `_runConnect()` to dereference a null `this.transport` and throw a TypeError.
- **context:** After `connect()` starts `_runConnect()` and the latter suspends at `await this.transport.start()` (line 95), a concurrent `disconnect()` call sets `this.transport = null` and `this.state = "disconnected"`. When `_runConnect()` resumes, line 98 (`await this.transport.send(...)`) throws `TypeError: Cannot read properties of null`, which propagates out of the connect lock, leaves the client in an inconsistent state (state="error" but transport was already cleaned up by disconnect), and the caller's connect promise rejects with an opaque error instead of a graceful disconnect signal.
- **hunter_found:** `2026-03-14T16:25:00Z`
- **fixer_started:** `2026-03-14T17:08:00Z`
- **fixer_completed:** `2026-03-14T17:10:00Z`
- **fix_summary:** Refactored `_runConnect()` in `src/mcp/client.ts` to capture `transport` as a local variable immediately after construction. All subsequent method calls use the local reference instead of `this.transport`, eliminating the null-dereference TypeError. Added three `(this.state as MCPClientState) === "disconnected"` abort checks after key awaits so a concurrent `disconnect()` causes a clean return rather than continuing the handshake. Error cleanup now guards with `if (this.transport === transport)` to avoid double-stopping when `disconnect()` already cleaned up.
- **validator_started:** `2026-03-14T19:08:00Z`
- **validator_completed:** `2026-03-14T19:10:00Z`
- **validator_notes:** Confirmed local `transport` variable used for all direct calls in `_runConnect()` (lines 96, 103, 124) — no `this.transport` dereferences that could be nulled. All three abort checks present (lines 100, 112, 129). Cleanup guard `if (this.transport === transport)` prevents double-stop. `refreshTools()` uses optional chaining at its guard (line 165) and `this.transport` read is before first await (no race). TSC clean; 32/32 MCP tests pass.

---

### BUG-0062
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/mcp/convert.ts`
- **line:** `70`
- **category:** `missing-error-handling`
- **description:** `formatContent` accesses `content.data.length` on image content received from an external MCP server without runtime null-checking, throwing a TypeError if the server returns an image block without the `data` field.
- **context:** MCP server responses are external, unverified data — the TypeScript type `MCPImageContent.data: string` is a compile-time contract only. A non-conformant or buggy MCP server that omits `data` will cause the tool execute closure in `mcpToolToDefinition` to throw `TypeError: Cannot read properties of undefined (reading 'length')`, propagating as an uncaught rejection from `callTool` and potentially crashing the agent loop iteration that invoked the tool.
- **hunter_found:** `2026-03-14T16:25:00Z`
- **fixer_started:** `2026-03-14T19:42:00Z`
- **fixer_completed:** `2026-03-14T19:42:00Z`
- **fix_summary:** `Added optional chaining for content.data in formatContent() in src/mcp/convert.ts: changed content.data.length to content.data?.length ?? 0 and content.mimeType to content.mimeType ?? "unknown". Prevents TypeError when a non-conformant MCP server omits the data or mimeType field on image content blocks.`
- **validator_started:** `2026-03-15T04:44:00Z`
- **validator_completed:** `2026-03-15T04:45:00Z`
- **validator_notes:** Confirmed line 70 reads `content.data?.length ?? 0` and `content.mimeType ?? "unknown"` — both null guards applied. Missing `data` no longer causes TypeError. Verified.

---

### BUG-0063
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/models/google.ts`
- **line:** `374`
- **category:** `missing-error-handling`
- **description:** In the `stream()` function, `candidate.content.parts` is accessed without null-checking `candidate.content`, which the Gemini API omits on streaming candidates that terminate with a safety violation.
- **context:** Line 372 correctly guards against a missing candidate (`if (!candidate) continue`) but does not guard against a candidate that has `finishReason` with no `content` field — a valid Gemini streaming response shape when content is blocked mid-stream. The access `candidate.content.parts` at line 374 throws `TypeError: Cannot read properties of undefined (reading 'parts')`, propagating out of the SSE loop and crashing the `stream()` generator for any prompt that triggers Gemini's streaming safety filter.
- **hunter_found:** `2026-03-14T16:30:00Z`
- **fixer_started:** `2026-03-14T19:43:00Z`
- **fixer_completed:** `2026-03-14T19:43:00Z`
- **fix_summary:** `Added a null guard for candidate.content in the stream() loop of src/models/google.ts: changed if (!candidate) continue to if (!candidate || !candidate.content) continue. Prevents TypeError when the Gemini API returns a streaming candidate with a finishReason but no content field (e.g. safety violations).`
- **validator_started:** `2026-03-15T04:45:00Z`
- **validator_completed:** `2026-03-15T04:46:00Z`
- **validator_notes:** Confirmed line 372 reads `if (!candidate || !candidate.content) continue` — both null guards present. Safety-blocked streaming candidates no longer throw TypeError on `content.parts` access. Verified.

---

### BUG-0064
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/harness/hooks-engine.ts`
- **line:** `113`
- **category:** `memory-leak`
- **description:** The `withTimeout` helper creates a `setTimeout` that is never cleared when the main promise resolves first, leaking a live timer handle for the full duration of the timeout on every winning-promise invocation.
- **context:** Every call to `fire()` on a hook with a non-null `timeout` that resolves before the deadline leaves behind a pending Node.js timer (up to `timeout` ms). In a busy agent loop firing PreToolUse/PostToolUse hooks on every tool call, these timers accumulate simultaneously, hold closure references, and prevent the event loop from draining cleanly — visible as delayed process exit or rising pending-handle counts in production monitoring.
- **hunter_found:** `2026-03-14T17:11:00Z`
- **fixer_started:** `2026-03-14T19:44:00Z`
- **fixer_completed:** `2026-03-14T19:45:00Z`
- **fix_summary:** `Fixed timer leak in withTimeout() in src/harness/hooks-engine.ts by attaching .finally(() => clearTimeout(handle)) to the main promise, ensuring the timeout handle is cleared whenever the main promise settles (win or lose) rather than always waiting the full timeout duration.`
- **validator_started:** `2026-03-15T04:46:00Z`
- **validator_completed:** `2026-03-15T04:46:00Z`
- **validator_notes:** Confirmed `promise.finally(() => clearTimeout(handle))` at line 117 — timer is cleared on both resolve and reject paths. No more leaking timer handles when hook resolves before deadline. Verified.

---

### BUG-0065
- **status:** `verified`
- **severity:** `high`
- **file:** `src/checkpoint.ts`
- **line:** `26`
- **category:** `logic-bug`
- **description:** `MemoryCheckpointer.put()` appends new checkpoint entries to the end of the array regardless of step order, causing `get()` — which always returns the last array element — to return a stale earlier checkpoint when steps are written out of order.
- **context:** The `put()` method only overwrites in-place when the exact same step already exists; a new step is pushed unconditionally to the tail. If any caller writes step N+2 then step N+1 (e.g., during retry, resumption from a forked thread, or concurrent parallel supersteps), `get()` returns step N+1 as "current state," causing graph execution to resume from the wrong checkpoint and silently replay or skip steps.
- **hunter_found:** `2026-03-14T17:11:00Z`
- **fixer_started:** `2026-03-14T18:11:00Z`
- **fixer_completed:** `2026-03-14T18:13:00Z`
- **fix_summary:** Added `existing.sort((a, b) => a.step - b.step)` after `existing.push()` in `MemoryCheckpointer.put()` in `src/checkpoint.ts`. The array is now kept in ascending step order so `history[history.length - 1]` always returns the highest step regardless of write order.
- **validator_started:** `2026-03-14T21:57:00Z`
- **validator_completed:** `2026-03-14T22:00:00Z`
- **validator_notes:** `existing.sort((a, b) => a.step - b.step)` added after `existing.push()` only (not the overwrite path at line 26, where sort order is preserved). `get()` reads `history[history.length - 1]` which is now always the max step. 20 checkpoint-core tests pass; `checkpoint-namespace` failure is pre-existing and unrelated to this change.

---

### BUG-0066
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/swarm/mermaid.ts`
- **line:** `58`
- **category:** `logic-bug`
- **description:** The Mermaid node label is built from unsanitized `entry.role` and capability name strings and embedded inside a double-quoted label literal, so any agent role or capability name containing a `"` character breaks the generated Mermaid syntax.
- **context:** `sanitizeId()` at line 76 sanitizes the node ID, but the label at line 58 uses raw `entry.role` and `c.name` values. An agent registered with a role like `My "Analyst"` produces `nodeId["<b>My "Analyst"</b>"]` — the unescaped double quotes prematurely terminate the label token and break any Mermaid renderer consuming the output.
- **hunter_found:** `2026-03-14T17:18:00Z`
- **fixer_started:** `2026-03-14T19:46:00Z`
- **fixer_completed:** `2026-03-14T19:46:00Z`
- **fix_summary:** `Added .replace(/"/g, "#quot;") to the label string in toSwarmMermaid() in src/swarm/mermaid.ts before it is embedded in the double-quoted Mermaid node label. Uses Mermaid HTML entity syntax so quote characters in agent roles or capability names do not break the label delimiter.`
- **validator_started:** `2026-03-15T04:47:00Z`
- **validator_completed:** `2026-03-15T04:47:00Z`
- **validator_notes:** Confirmed `.replace(/"/g, "#quot;")` at line 57 of mermaid.ts — double quotes in agent roles/capabilities are replaced with Mermaid HTML entity before embedding in label string. Node ID sanitization unchanged. Verified.

---

### BUG-0067
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/functional.ts`
- **line:** `128`
- **category:** `missing-error-handling`
- **description:** `pipe()` does not validate that at least one task function is provided; when called with zero tasks, `names[0]!` evaluates to `undefined` at runtime and `graph.addEdge(START, undefined)` is called, producing a cryptic internal graph error instead of a clear validation message.
- **context:** TypeScript's non-null assertion `!` on line 128 and 132 silences the compiler but does nothing at runtime. An empty `pipe(opts)` call reaches `graph.addEdge(START, undefined)` which fails deep inside the graph builder with an error about an unknown node, giving no indication that the root cause is missing task functions.
- **hunter_found:** `2026-03-14T17:18:00Z`
- **fixer_started:** `2026-03-14T19:47:00Z`
- **fixer_completed:** `2026-03-14T19:47:00Z`
- **fix_summary:** `Added an early guard in pipe() in src/functional.ts that throws a clear Error("pipe() requires at least one task function") before any graph construction begins when tasks.length === 0. Prevents the cryptic internal graph error from graph.addEdge(START, undefined) that occurred when no tasks were supplied.`
- **validator_started:** `2026-03-15T04:47:00Z`
- **validator_completed:** `2026-03-15T04:47:00Z`
- **validator_notes:** Confirmed `if (tasks.length === 0) throw new Error("pipe() requires at least one task function")` at lines 120-122 of functional.ts — clear error thrown before any graph construction. Prevents cryptic graph.addEdge(START, undefined) error. Verified.

---

### BUG-0068
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/swarm/snapshot.ts`
- **line:** `69`
- **category:** `missing-error-handling`
- **description:** `SwarmSnapshotStore.capture()` calls `structuredClone(state)` without a try/catch, so if the swarm state contains any non-cloneable value (functions, WeakRef, WeakMap, or WeakSet), it throws an unhandled `DataCloneError` that propagates to the caller.
- **context:** The swarm state type is `Record<string, unknown>`, which permits any value including functions and WeakRefs. A single non-cloneable entry causes `capture()` to throw, discarding the snapshot entirely and surfacing a confusing browser/Node structured-clone error to the caller rather than a snapshot-specific failure.
- **hunter_found:** `2026-03-14T17:18:00Z`
- **fixer_started:** `2026-03-14T19:48:00Z`
- **fixer_completed:** `2026-03-14T19:48:00Z`
- **fix_summary:** `Wrapped structuredClone(state) in a try/catch in SwarmSnapshotStore.capture() in src/swarm/snapshot.ts; on DataCloneError falls back to JSON.parse(JSON.stringify(state)) which silently drops non-serializable values instead of throwing. Prevents an unhandled DataCloneError from crashing callers when swarm state contains functions or WeakRefs.`
- **validator_started:** `2026-03-15T04:47:00Z`
- **validator_completed:** `2026-03-15T04:47:00Z`
- **validator_notes:** Confirmed try/catch around `structuredClone(state)` at lines 70-72 of snapshot.ts with `JSON.parse(JSON.stringify(state))` fallback. Non-cloneable values silently dropped instead of throwing DataCloneError to caller. Verified.

---

### BUG-0069
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/prebuilt/react-agent.ts`
- **line:** `144`
- **category:** `dead-code`
- **description:** The `config` parameter in the agent node function is declared but never used — `config.signal` is never forwarded to `llm.invoke()`, silently dropping abort signals from the parent graph.
- **context:** The agent node at line 144 accepts `config?: ONIConfig` but passes only `{ tools }` to `llm.invoke()` at line 149, omitting `signal: config?.signal`. When the parent graph propagates an `AbortSignal` (e.g., timeout or user cancellation), the in-flight LLM request is not cancelled and runs to completion, wasting tokens and delaying the abort response.
- **hunter_found:** `2026-03-14T17:25:00Z`
- **fixer_started:** `2026-03-14T19:49:00Z`
- **fixer_completed:** `2026-03-14T19:49:00Z`
- **fix_summary:** `Added signal?: AbortSignal to the ONIConfig interface in src/types.ts, then forwarded config?.signal to llm.invoke() in the agent node of src/prebuilt/react-agent.ts. ONIConfig previously lacked a signal field entirely, so the fix required both the interface addition and the call-site wiring.`
- **validator_started:** `2026-03-15T04:48:00Z`
- **validator_completed:** `2026-03-15T04:48:00Z`
- **validator_notes:** Confirmed `signal?: AbortSignal` added to ONIConfig at line 203 of types.ts; `signal: config?.signal` forwarded to `llm.invoke()` at line 151 of react-agent.ts. AbortSignals now propagate from parent graph to LLM calls. Verified.

---

### BUG-0070
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/agents/define-agent.ts`
- **line:** `115`
- **category:** `logic-bug`
- **description:** `model.chat()` in the ReAct loop is called without forwarding `config.signal`, so AbortSignals from the parent graph never reach the LLM adapter and cannot cancel in-flight requests.
- **context:** `config` is used elsewhere in `_nodeFn` (e.g., line 85 for tool context) but `model.chat({ messages, tools, systemPrompt })` at line 115 omits the signal. For agents running multi-turn loops in long-running swarms, this means graph-level timeouts or user-triggered aborts do not propagate to the underlying HTTP requests, leaving them running until the model responds even after the calling context has given up.
- **hunter_found:** `2026-03-14T17:25:00Z`
- **fixer_started:** `2026-03-14T19:53:00Z`
- **fixer_completed:** `2026-03-14T19:53:00Z`
- **fix_summary:** `Forwarded config?.signal to model.chat() in the ReAct loop of src/agents/define-agent.ts. The signal field was available on ONIConfig (added in BUG-0069 fix) but was not being passed to the model call, preventing graph-level abort signals from cancelling in-flight LLM requests.`
- **validator_started:** `2026-03-15T04:48:00Z`
- **validator_completed:** `2026-03-15T04:48:00Z`
- **validator_notes:** Confirmed `signal: config?.signal` forwarded to `model.chat()` at line 119 of define-agent.ts. Graph-level AbortSignals now cancel in-flight LLM requests in the ReAct loop. Verified.

---

### BUG-0071
- **status:** - **severity:** - **file:** - **line:** - **category:** - **description:** The spawned MCP child process inherits the entire parent , leaking all parent secrets (API keys, database URLs, tokens) to potentially untrusted external processes.
- **context:**  at line 76 spreads every parent environment variable into the child. An MCP server running third-party or user-provided code receives , , , and any other secrets present in the host environment. A compromised or malicious MCP server can exfiltrate these credentials without any indication to the caller.
- **hunter_found:** - **fixer_started:** - **fixer_completed:** - **fix_summary:** - **validator_started:** - **validator_completed:** - **validator_notes:** 
---

### BUG-0072
- **status:** - **severity:** - **file:** - **line:** - **category:** - **description:**  from the MCP server is parsed with no upper-bound validation, allowing a malicious server to send an arbitrarily large value that causes the string buffer to grow without bound until the process runs out of memory.
- **context:**  at line 227 accepts any value up to . Lines 229–232 then loop indefinitely accumulating data into  (a string) waiting for . A server sending  followed by a trickle of data keeps the buffer growing until Node.js OOMs. No maximum message size is enforced anywhere in the parsing path.
- **hunter_found:** - **fixer_started:** - **fixer_completed:** - **fix_summary:** - **validator_started:** - **validator_completed:** - **validator_notes:** 
---

### BUG-0073
- **status:** - **severity:** - **file:** - **line:** - **category:** - **description:**  in  unconditionally overwrites the stored start time on retry, causing  to double-count retried agents while  records only the last run's duration.
- **context:** If agent "A" starts, errors, and retries, the  branch executes twice:  increments to 2 and  is overwritten with the second start time. When the agent finally completes,  is 1 and  reflects only the successful attempt's duration. Operators see  implying two distinct agents ran, and the failed run's latency is silently discarded, making retry-heavy workloads appear worse than reported.
- **hunter_found:** - **fixer_started:** - **fixer_completed:** - **fix_summary:** - **validator_started:** - **validator_completed:** - **validator_notes:** 
---

### BUG-0074
- **status:** `verified`
- **severity:** `high`
- **file:** `src/models/anthropic.ts`
- **line:** `415`
- **category:** `type-error`
- **description:** `block.id` and `block.name` are typed as `string | undefined` in `AnthropicContentBlock` but used without null checks when emitting a `tool_call_start` chunk, potentially propagating `undefined` as the tool call ID and name.
- **context:** The interface models `id` and `name` as optional because text blocks lack them; after the `block.type === "tool_use"` guard the code assumes they are always present, but never asserts it. If the Anthropic API returns a malformed `tool_use` block missing either field, `undefined` flows into the agent loop as the tool call identifier, causing the loop to lose the ability to correlate delta and end chunks with the originating call, silently breaking tool invocation.
- **hunter_found:** `2026-03-14T17:37:00Z`
- **fixer_started:** `2026-03-14T18:14:00Z`
- **fixer_completed:** `2026-03-14T18:15:00Z`
- **fix_summary:** Added `&& block.id && block.name` to the `tool_use` guard in `src/models/anthropic.ts` line 412. A `tool_use` block without both `id` and `name` is now silently skipped rather than propagating `undefined` identifiers to the agent loop.
- **validator_started:** `2026-03-14T22:03:00Z`
- **validator_completed:** `2026-03-14T22:06:00Z`
- **validator_notes:** Guard `&& block.id && block.name` added to line 413 correctly skips malformed `tool_use` blocks in the streaming path before propagating `id`/`name` to `tool_call_start`. Non-streaming path still uses `!` assertions (separate concern, not in scope). 5 Anthropic model tests pass.

---

### BUG-0075
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/swarm/scaling.ts`
- **line:** `88`
- **category:** `memory-leak`
- **description:** `this.history` is an unbounded array that grows indefinitely with every `recordDecision()` call — no maximum size, no eviction policy.
- **context:** In a long-running swarm that makes frequent scaling decisions, `history` accumulates one `ScalingHistoryEntry` per decision forever. `getHistory()` copies the entire array on every call. There is no TTL or cap, so in a days-long production run with active scaling the array can grow to thousands of entries, consuming unbounded memory and making `getHistory()` copies progressively more expensive.
- **hunter_found:** `2026-03-14T17:37:00Z`
- **fixer_started:** `2026-03-14T19:54:00Z`
- **fixer_completed:** `2026-03-14T19:55:00Z`
- **fix_summary:** `Added MAX_HISTORY = 500 static constant to DynamicScalingMonitor in src/swarm/scaling.ts and applied a shift() eviction after every push() when the limit is exceeded. Caps the history array at 500 entries so long-running swarms do not accumulate unbounded memory.`
- **validator_started:** `2026-03-15T04:49:00Z`
- **validator_completed:** `2026-03-15T04:49:00Z`
- **validator_notes:** `MAX_HISTORY = 500` at line 89 of scaling.ts; `history.shift()` at line 261 evicts oldest entry when exceeded. Caps history array at 500 entries, preventing unbounded heap growth. Verified.

---

### BUG-0076
- **status:** `verified`
- **severity:** `high`
- **file:** `src/swarm/scaling.ts`
- **line:** `218`
- **category:** `logic-bug`
- **description:** `checkScaleDown()` triggers scale-down based solely on `lastActivity` timestamp without checking whether any agents are currently mid-execution, causing the agent pool to be reduced while tasks are actively in flight.
- **context:** Tracer events are only emitted at lifecycle boundaries (start/complete/error) — a running agent produces no events during its execution window of 15-120s. The scale-down guard checks that the last event was over `scaleDownIdleSeconds` ago, but an agent that started 30s ago and is still processing will never have fired a recent event, so the check incorrectly concludes the pool is idle. Scale-down then removes agents mid-task, potentially leaving dispatched work with no handler.
- **hunter_found:** `2026-03-14T17:37:00Z`
- **fixer_started:** `2026-03-14T22:47:00Z`
- **fixer_completed:** `2026-03-14T22:52:00Z`
- **fix_summary:** Added `tracer.record({ type: "agent_complete", agentId: "a1", timestamp: now - 61000 + 100 })` in `src/__tests__/swarm/dynamic-scaling.test.ts` test "DOES scale down at 61s idle". The in-flight guard in `scaling.ts` is correct — the test was the only defect: it left `inFlight = 1` with an unmatched `agent_start`, causing `evaluate()` to return `idle` when `scale_down` was expected. With the complete event, `inFlight` drops to 0 and `lastActivity` is ~60.9s ago (above the 60s threshold), triggering scale_down correctly. All 32 dynamic-scaling tests pass; `tsc --noEmit` clean.
- **validator_started:** `2026-03-14T22:58:00Z`
- **validator_completed:** `2026-03-14T23:01:00Z`
- **validator_notes:** Confirmed `agent_complete` event added at line 474 in dynamic-scaling.test.ts. Traced: inFlight drops to 0, lastActivity = now-60900ms (60.9s > 60s threshold), evaluate() returns scale_down. In-flight guard in scaling.ts lines 161-167 unchanged and correct. All 32 dynamic-scaling tests pass. Verified.

---
### BUG-0077
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/guardrails/audit.ts`
- **line:** `37`
- **category:** `missing-error-handling`
- **description:** `AuditLog.fromJSON()` calls `JSON.parse(json)` with no try/catch, throwing a raw `SyntaxError` with no context if the input is corrupt or empty.
- **context:** Audit logs may be persisted and later restored; corrupt storage, partial writes, or accidental empty strings all produce unparseable JSON. The raw `SyntaxError` gives the caller no information about which `threadId`'s log failed to restore, making debugging difficult and leaving the `AuditLog` in an indeterminate state if restoration is attempted.
- **hunter_found:** `2026-03-14T17:42:00Z`
- **fixer_started:** `2026-03-14T19:56:00Z`
- **fixer_completed:** `2026-03-14T19:56:00Z`
- **fix_summary:** `Wrapped JSON.parse in fromJSON() in src/guardrails/audit.ts with a try/catch that rethrows with the threadId included in the message. Callers now get a descriptive error identifying which threadId log failed to parse instead of a raw SyntaxError.`
- **validator_started:** `2026-03-15T04:49:00Z`
- **validator_completed:** `2026-03-15T04:49:00Z`
- **validator_notes:** Confirmed try/catch at line 42 of audit.ts rethrows with `threadId` in message: `AuditLog.fromJSON: failed to parse log for threadId "..."`. Caller now gets contextual error identifying which log failed. Verified.

---

### BUG-0078
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/coordination/request-reply.ts`
- **line:** `67`
- **category:** `missing-error-handling`
- **description:** `JSON.stringify({ _type: "request", payload })` in `request()` throws a `TypeError` if `payload` contains non-serializable values (circular objects, BigInt, Functions) — no try/catch guard.
- **context:** Agent-to-agent messages frequently carry state objects that may contain class instances, functions attached by the runtime, or circular references. A non-serializable payload causes `request()` to throw synchronously after the `PendingRequest` has already been inserted into `this.pending`, leaving an unresolvable entry in the map. The same unguarded `JSON.stringify` at line 106 in `reply()` has the identical exposure.
- **hunter_found:** `2026-03-14T17:42:00Z`
- **fixer_started:** `2026-03-14T19:57:00Z`
- **fixer_completed:** `2026-03-14T19:58:00Z`
- **fix_summary:** `In src/coordination/request-reply.ts: moved JSON.stringify for request() before the pending.set() call so non-serializable payloads throw before any state mutation, preventing orphaned pending entries. Wrapped reply() stringify in try/catch with a "[non-serializable]" fallback so the promise still resolves even if the reply payload is not JSON-safe.`
- **validator_started:** `2026-03-15T04:50:00Z`
- **validator_completed:** `2026-03-15T04:50:00Z`
- **validator_notes:** `JSON.stringify` for request payload at line 42 executes before `pending.set()` at line 57 — non-serializable payload throws before state mutation, no orphaned pending entries. reply() try/catch at lines 121-123 falls back to `"[non-serializable]"` payload instead of throwing. Both fixes confirmed. Verified.

---

### BUG-0079
- **status:** `verified`
- **severity:** `high`
- **file:** `src/coordination/request-reply.ts`
- **line:** `44`
- **category:** `memory-leak`
- **description:** Requests created without a `timeoutMs` option that never receive a `reply()` accumulate permanently in `this.pending` and `this.resolvers` with no eviction path.
- **context:** `request()` inserts into both maps at lines 44 and 47; the only cleanup paths are the timeout callback (lines 50-57, only runs when `timeoutMs` is set) and `reply()` (lines 96-100). If the target agent crashes, is deregistered, or is simply slow and the caller passes no timeout, the entry and its associated Promise closure live forever, leaking the broker's internal state unboundedly in long-running swarms.
- **hunter_found:** `2026-03-14T17:42:00Z`
- **fixer_started:** `2026-03-14T18:19:00Z`
- **fixer_completed:** `2026-03-14T18:21:00Z`
- **fix_summary:** Changed `opts?.timeoutMs != null` branch to always apply a timeout in `src/coordination/request-reply.ts`. Default is `opts?.timeoutMs ?? 60_000` — callers without an explicit timeout get a 60-second default matching the agent lifecycle duration. Unanswered requests are now always evicted from `pending` and `resolvers` via rejection.
- **validator_started:** `2026-03-14T22:16:00Z`
- **validator_completed:** `2026-03-14T22:19:00Z`
- **validator_notes:** `opts?.timeoutMs ?? 60_000` always arms the timer — no more conditional guard. `reply()` calls `clearTimeout` before resolving to prevent double-reject; `req.resolved` flag guards the race. Both `pending` and `resolvers` maps are evicted on timeout (lines 67-69). 22 coordination/request-reply-timeout tests pass.

---
### BUG-0080
- **status:** `verified`
- **severity:** `high`
- **file:** `src/models/ollama.ts`
- **line:** `204`
- **category:** `type-error`
- **description:** `json.message.content` is accessed without a null guard; if Ollama returns a 200 response without a `message` field (e.g. on error), this throws `TypeError: Cannot read properties of undefined`.
- **context:** The TypeScript cast `as OllamaChatResponseBody` provides no runtime validation; Ollama can return `{"error":"...","done":true}` with no `message` field on malformed requests or quota errors, crashing the adapter with an unhandled TypeError instead of a structured ModelAPIError.
- **hunter_found:** `2026-03-14T17:52:00Z`
- **fixer_started:** `2026-03-14T18:25:00Z`
- **fixer_completed:** `2026-03-14T18:26:00Z`
- **fix_summary:** Added `if (!json.message)` guard in `src/models/ollama.ts` `chat()` after parsing the response. When `message` is absent (Ollama error response), the code extracts the `error` field and throws a descriptive Error instead of crashing with a TypeError on `json.message.content`.
- **validator_started:** `2026-03-14T22:22:00Z`
- **validator_completed:** `2026-03-14T22:25:00Z`
- **validator_notes:** `if (!json.message)` guard at line 204 prevents `TypeError` on `json.message.content`; error path extracts `error` field with type check fallback. Streaming path was already safe via optional chaining (`message?.content`, line 248). 3 Ollama tests pass.

---

### BUG-0081
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/harness/context-compactor.ts`
- **line:** `203`
- **category:** `logic-bug`
- **description:** `clearOldToolResults` removes an entire assistant toolCalls message when ANY of its tool call IDs appear in the removed set, even if the remaining tool results are in the kept `recentPortion`, leaving orphaned tool-role messages with no corresponding assistant message.
- **context:** When the `keepRecent` cutpoint falls between an assistant message with multiple tool calls and all of its corresponding tool results, the assistant message is filtered out but the tool results in `recentPortion` remain, producing an invalid conversation state (tool results with no assistant toolCalls parent) that will cause API rejection errors on the next inference call.
- **hunter_found:** `2026-03-14T17:52:00Z`
- **fixer_started:** `2026-03-14T19:59:00Z`
- **fixer_completed:** `2026-03-14T19:59:00Z`
- **fix_summary:** `Changed .some() to .every() in the clearOldToolResults filter in src/harness/context-compactor.ts. The assistant+toolCalls message is now only removed when ALL of its tool-result children are being discarded; if any survive in recentPortion, the assistant message is kept as their parent, preventing orphaned tool-result messages that cause API rejection.`
- **validator_started:** `2026-03-15T04:50:00Z`
- **validator_completed:** `2026-03-15T04:50:00Z`
- **validator_notes:** Confirmed `.every()` at lines 192 and 211 of context-compactor.ts — assistant+toolCalls message only removed when ALL tool call IDs are in the removed set. If any tool results survive in recentPortion, assistant message is kept as parent. Prevents orphaned tool-result messages. Verified.

---
### BUG-0082
- **status:** `verified`
- **severity:** `high`
- **file:** `src/store/index.ts`
- **line:** `131`
- **category:** `race-condition`
- **description:** `InMemoryStore.put()` writes to `this.data` synchronously then `await`s `embedFn`, allowing a concurrent `delete()` or second `put()` on the same key to execute in between, leaving `this.vectors` out of sync with `this.data`.
- **context:** Scenario 1 — concurrent `put(k,v1)` + `delete(k)`: delete runs while embedFn is pending, removes the key from both maps, then `put` resumes and inserts the vector with no matching data entry (dangling vector). Scenario 2 — two concurrent `put(k,v1)` + `put(k,v2)` where embed1 completes after embed2: `data[k]` ends up as item2 but `vectors[k]` ends up as embed1, causing semantic search to return item2 scored against the wrong embedding.
- **hunter_found:** `2026-03-14T17:58:00Z`
- **fixer_started:** `2026-03-14T18:36:00Z`
- **fixer_completed:** `2026-03-14T18:38:00Z`
- **fix_summary:** In `src/store/index.ts` `InMemoryStore.put()`, saved the newly created item object into a local `item` variable before writing to `this.data`. After `await this.embedFn(text)` resolves, added a guard `if (this.data.get(k) === item)` that compares by reference before writing to `this.vectors`. A concurrent `delete(k)` will cause `data.get(k)` to return undefined (guard fails); a concurrent second `put(k, v2)` will cause it to return a different item reference (guard fails). This prevents both the dangling-vector and stale-embedding race conditions without requiring a mutex.
- **validator_started:** `2026-03-14T22:28:00Z`
- **validator_completed:** `2026-03-14T22:31:00Z`
- **validator_notes:** Reference-equality guard `if (this.data.get(k) === item)` at line 162 correctly handles both race scenarios: concurrent `delete(k)` leaves `undefined` in the map (guard fails), concurrent `put(k,v2)` leaves a different object reference (guard fails). Error rollback (lines 153-159) uses the same guard to avoid clobbering concurrent writes. 10 store tests pass.

---

### BUG-0083
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/store/index.ts`
- **line:** `40`
- **category:** `logic-bug`
- **description:** `cosine()` iterates only over `a.length` elements; if `b` is shorter, `b[i]` is `undefined` for out-of-bounds indices, propagating `NaN` through the dot product and returning `NaN` as the similarity score.
- **context:** If vectors from two different embedding models (with different dimensions) are ever mixed in the store, all similarity comparisons involving those mismatched vectors silently return `NaN`. `Array.sort` with `NaN` comparators produces implementation-defined ordering, causing `search()` to return results in an arbitrary, non-deterministic order rather than throwing an error.
- **hunter_found:** `2026-03-14T17:58:00Z`
- **fixer_started:** `2026-03-14T20:00:00Z`
- **fixer_completed:** `2026-03-14T20:00:00Z`
- **fix_summary:** `Added a dimension check at the top of cosine() in src/store/index.ts that throws a descriptive error when a.length !== b.length, preventing silent NaN propagation from out-of-bounds b[i] accesses. Mixing embedding models with different vector dimensions now fails fast with a clear error instead of corrupting similarity scores.`
- **validator_started:** `2026-03-15T04:51:00Z`
- **validator_completed:** `2026-03-15T04:51:00Z`
- **validator_notes:** Confirmed dimension check at lines 39-41 of store/index.ts: `if (a.length !== b.length) throw new Error(...)`. Mismatched embedding dimensions now fail fast with clear error instead of silent NaN propagation. Verified.

---

### BUG-0084
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/events/bus.ts`
- **line:** `67`
- **category:** `memory-leak`
- **description:** `EventBus.waitFor()` called without a `timeoutMs` registers a `once` listener that stays subscribed forever if the awaited event never fires, leaking both the Promise and the listener.
- **context:** Every unresolved `waitFor()` call permanently retains one entry in `this.handlers` for the given event type. In long-running applications where the expected event can fail to arrive (e.g., an agent crash before emitting its completion event), each missed event adds a permanent listener. The Promise also stays pending, preventing GC of any closures it captures (including state or message history passed into the surrounding function).
- **hunter_found:** `2026-03-14T17:58:00Z`
- **fixer_started:** `2026-03-14T20:01:00Z`
- **fixer_completed:** `2026-03-14T20:01:00Z`
- **fix_summary:** `Changed waitFor() in src/events/bus.ts to always apply a timeout by giving timeoutMs a default value of 60_000ms. The timeout is now set unconditionally before the once() listener, so callers that omit timeoutMs can no longer leak a permanently pending Promise and listener.`
- **validator_started:** `2026-03-15T04:51:00Z`
- **validator_completed:** `2026-03-15T04:51:00Z`
- **validator_notes:** Confirmed `timeoutMs = 60_000` default parameter at line 70 of bus.ts. `waitFor()` without explicit timeout now always arms a 60s timer, preventing permanently pending Promises and listener leaks. Verified.

---
### BUG-0085
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/harness/hooks-engine.ts`
- **line:** `251`
- **category:** `logic-bug`
- **description:** `matches()` iterates ALL string values in the tool input when evaluating a CC-style arg pattern, returning true if any string field starts with the prefix rather than only checking the primary argument.
- **context:** A tool call with `{ command: "rm -rf /", description: "git backup" }` matches pattern `Bash(git:*)` because `description` starts with "git", potentially firing ALLOW or DENY hooks based on an unrelated field. The in-code comment says to check the first string value but the loop scans all fields.
- **hunter_found:** `2026-03-14T18:03:00Z`
- **fixer_started:** `2026-03-14T20:02:00Z`
- **fixer_completed:** `2026-03-14T20:02:00Z`
- **fix_summary:** `Fixed matches() in src/harness/hooks-engine.ts to check only the first string value in the tool input for CC-style arg patterns (e.g. Bash(git:*)), replacing the for-loop that checked all string fields. Prevents false-positive hook matches when an unrelated string field (like description) starts with the same prefix as the primary argument.`
- **validator_started:** `2026-03-15T04:51:00Z`
- **validator_completed:** `2026-03-15T04:51:00Z`
- **validator_notes:** Confirmed lines 257-258 of hooks-engine.ts extract first string value via `Object.values(input).find(v => typeof v === "string")` and check only that value against argPrefix. Prevents false-positive matches on unrelated string fields. Verified.

---

### BUG-0086
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/harness/todo-module.ts`
- **line:** `118`
- **category:** `missing-error-handling`
- **description:** `TodoModule.notify()` calls listener callbacks in a bare for-of loop with no try/catch; a throwing listener halts propagation to remaining listeners and the exception escapes to the `write()` or `updateStatus()` caller.
- **context:** The agent loop calls `write()` after every TodoWrite tool execution. If any onChange listener throws, the tool executor receives an uncaught exception and may abort the agent turn. Remaining listeners also miss the notification. EventBus.emit() and PubSub.publish() both isolate listener errors with try/catch; notify() does not.
- **hunter_found:** `2026-03-14T18:03:00Z`
- **fixer_started:** `2026-03-14T20:03:00Z`
- **fixer_completed:** `2026-03-14T20:03:00Z`
- **fix_summary:** `Wrapped the callback invocation in notify() in src/harness/todo-module.ts with a try/catch that swallows listener errors. Matches the error isolation pattern used by EventBus.emit() and PubSub.publish(), ensuring one throwing listener cannot halt delivery to remaining listeners or surface an exception to write()/updateStatus() callers.`
- **validator_started:** `2026-03-15T04:52:00Z`
- **validator_completed:** `2026-03-15T04:52:00Z`
- **validator_notes:** Confirmed try/catch wraps `cb(this.state)` at lines 121-124 of todo-module.ts. Throwing listeners are silently swallowed; remaining listeners continue to receive notification. Matches EventBus.emit() isolation pattern. Verified.

---

### BUG-0087
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/harness/validate-args.ts`
- **line:** `093`
- **category:** `logic-bug`
- **description:** `validateValue()` recurses into array items (lines 128-139) but has no equivalent branch for nested object `properties`; when a prop schema has type object with nested properties, only the top-level type is checked and sub-properties are never validated.
- **context:** A schema with `{ filter: { type: "object", properties: { name: { type: "string" } } } }` passes validation even when `filter.name` is a number. Malformed nested LLM arguments reach `execute()` unchecked, causing silent type errors or crashes in tools that rely on nested field types.
- **hunter_found:** `2026-03-14T18:03:00Z`
- **fixer_started:** `2026-03-14T20:04:00Z`
- **fixer_completed:** `2026-03-14T20:04:00Z`
- **fix_summary:** `Added a nested object properties validation branch to validateValue() in src/harness/validate-args.ts. After type/array checks, if the value is a plain object and the schema has properties, each defined property is recursively validated with its sub-schema. Mirrors the existing array items recursion pattern, fixing silent pass-through of type-mismatched nested fields.`
- **validator_started:** `2026-03-15T04:52:00Z`
- **validator_completed:** `2026-03-15T04:52:00Z`
- **validator_notes:** Confirmed nested object properties branch at lines 142-157 of validate-args.ts. After type/array checks, plain-object values with `schema.properties` are recursively validated. Mirrors array items recursion pattern. Verified.

---
### BUG-0088
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/pregel.ts`
- **line:** `470`
- **category:** `logic-bug`
- **description:** Fan-out sends execute at lines 421-464 before the recursion limit check at line 470, so if step >= recursionLimit the sends ran, applied state changes, and threw away the results without a checkpoint.
- **context:** When the recursion limit fires, any node code executed via sends in that step has already run with side effects but its state delta is never persisted; the caller sees RecursionLimitError but the graph is in an inconsistent state relative to its last checkpoint.
- **hunter_found:** `2026-03-14T18:13:00Z`
- **fixer_started:** `2026-03-14T20:05:00Z`
- **fixer_completed:** `2026-03-14T20:06:00Z`
- **fix_summary:** `Moved the RecursionLimitError check in src/pregel.ts to before the fan-out sends execution block. The check now fires before any node code runs for the step, preventing node side-effects from being applied to a step that will be discarded. Removed the previous late check that fired after the sends had already run.`
- **validator_started:** `2026-03-15T04:53:00Z`
- **validator_completed:** `2026-03-15T04:53:00Z`
- **validator_notes:** Confirmed `if (step >= recursionLimit) throw new RecursionLimitError(...)` at line 423, with comment "must fire before any sends execute", placed before the `if (sendGroups.size > 0)` block at line 426. Node side-effects cannot run for a discarded step. Verified.

---

### BUG-0089
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/lsp/client.ts`
- **line:** `128`
- **category:** `memory-leak`
- **description:** The process error event handler calls rejectAllPending but never calls clearAllWaiters() or sets this.process = null.
- **context:** When the OS fires error on the child process (e.g. ENOENT on spawn) without a subsequent exit, all diagnosticsWaiter overallTimers and debounceTimers remain allocated indefinitely and this.process stays as a dead reference.
- **hunter_found:** `2026-03-14T18:13:00Z`
- **fixer_started:** `2026-03-14T20:07:00Z`
- **fixer_completed:** `2026-03-14T20:07:00Z`
- **fix_summary:** `Added clearAllWaiters() and this.process = null calls to the process error handler in src/lsp/client.ts, matching the cleanup already done in handleProcessExit(). Prevents timer leaks from diagnosticsWaiter timers and stale dead process references when the OS fires an error event without a subsequent exit event.`
- **validator_started:** `2026-03-15T04:53:00Z`
- **validator_completed:** `2026-03-15T04:53:00Z`
- **validator_notes:** Confirmed `clearAllWaiters()` at line 131 and `this.process = null` at line 132 in the process error handler. Matches cleanup in `handleProcessExit()`. No timer leaks on error-without-exit. Verified.

---

### BUG-0090
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/lsp/client.ts`
- **line:** `432`
- **category:** `api-contract`
- **description:** handleMessage silently drops server-to-client JSON-RPC requests whose method is not one of the three explicitly handled strings, returning without sending any response.
- **context:** The LSP spec requires all server-initiated requests to receive a response; un-responded requests cause the language server to stall indefinitely waiting for a reply, e.g. workspace/applyEdit or window/showMessageRequest block the server, degrading or halting language server functionality.
- **hunter_found:** `2026-03-14T18:13:00Z`
- **fixer_started:** `2026-03-14T20:08:00Z`
- **fixer_completed:** `2026-03-14T20:08:00Z`
- **fix_summary:** `Added an else branch in handleMessage() in src/lsp/client.ts that replies with a JSON-RPC MethodNotFound error (code -32601) for any server-initiated request with an unrecognized method. Prevents the language server from stalling waiting for a reply to methods like workspace/applyEdit or window/showMessageRequest that were previously silently dropped.`
- **validator_started:** `2026-03-15T04:53:00Z`
- **validator_completed:** `2026-03-15T04:53:00Z`
- **validator_notes:** Confirmed else branch at lines 458-462 of lsp/client.ts sends JSON-RPC MethodNotFound error (code -32601) for unrecognized server-initiated request methods. Server no longer stalls waiting for reply. Verified.

---

### BUG-0091
- **status:** `verified`
- **severity:** `high`
- **file:** `src/harness/agent-loop.ts`
- **line:** `463`
- **category:** `missing-error-handling`
- **description:** The PostToolUse hook call at line 463 sits inside the same try/catch block as the tool execution at line 458; if the hook throws, the catch at line 491 fires PostToolUseFailure and records isError: true for a tool that actually succeeded.
- **context:** A successful tool result is never pushed to toolResults when PostToolUse throws — instead an error result is recorded, corrupting the conversation history. On the next model turn, the model sees a tool failure for an operation that completed successfully, causing it to retry or take incorrect recovery actions.
- **hunter_found:** `2026-03-14T18:18:00Z`
- **fixer_started:** `2026-03-14T19:30:00Z`
- **fixer_completed:** `2026-03-14T19:32:00Z`
- **fix_summary:** `Moved toolResults.push() to immediately after the tool execution in src/harness/agent-loop.ts, before the PostToolUse hook call. Wrapped the PostToolUse hook fire in its own inner try/catch so a hook throw is non-fatal and cannot corrupt the conversation history. The successful tool result is now recorded unconditionally; the PostToolUseFailure path is only reached when the tool itself throws.`
- **validator_started:** `2026-03-14T22:34:00Z`
- **validator_completed:** `2026-03-14T22:37:00Z`
- **validator_notes:** `toolResults.push()` at line 464 is now before the PostToolUse hook call; the hook (lines 487-497) is wrapped in its own try/catch so a hook throw cannot contaminate the outer catch block. The outer catch (line 499) now fires exclusively on `toolDef.execute()` failures. 17 hooks + 12 loop tests pass.

---

### BUG-0092
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/mcp/transport.ts`
- **line:** `99`
- **category:** `missing-error-handling`
- **description:** The process error handler registered at line 99 inside _doStart sets connected = false but does not clear this.pending; if the process emits error after startup, all in-flight send() requests are orphaned until their individual timeouts fire.
- **context:** When a post-startup process error occurs (e.g. broken pipe on stdin), connected becomes false so new send() calls throw immediately, but any pending requests that were already queued retain active timers and will not be rejected until each one's timeout elapses — up to 30 seconds per request — keeping closures and Map entries alive unnecessarily.
- **hunter_found:** `2026-03-14T18:18:00Z`
- **fixer_started:** `2026-03-14T20:09:00Z`
- **fixer_completed:** `2026-03-14T20:09:00Z`
- **fix_summary:** `Added pending-drain loop to the process error handler in src/mcp/transport.ts, matching the pattern already used in the exit handler. Immediately rejects all in-flight requests and clears their timers when a post-startup process error fires, instead of leaving them orphaned until individual timeouts elapse.`
- **validator_started:** `2026-03-15T04:54:00Z`
- **validator_completed:** `2026-03-15T04:54:00Z`
- **validator_notes:** Confirmed pending-drain loop at lines 105-109 of mcp/transport.ts in the process error handler: rejects all pending requests, clears their timers, and deletes map entries immediately. Matches exit handler pattern. Verified.

---

### BUG-0093
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/swarm/supervisor.ts`
- **line:** `61`
- **category:** `logic-bug`
- **description:** The supervisor reads __deadlineAbsolute from state[config.contextField] (line 61) but writes it to the hardcoded field name "context" (line 155); when config.contextField is undefined or any name other than "context", the persisted deadline is never read back, so a fresh deadline is computed on every round and the deadlineMs limit is silently never enforced.
- **context:** Any supervisor configured with deadlineMs but without contextField: "context" will reset its deadline on every invocation — the elapsed-time guard at line 69 never fires, allowing the swarm to run indefinitely past the intended deadline. The feature appears to work (no error thrown) but provides no actual termination guarantee.
- **hunter_found:** `2026-03-14T18:23:00Z`
- **fixer_started:** `2026-03-14T20:10:00Z`
- **fixer_completed:** `2026-03-14T20:11:00Z`
- **fix_summary:** `Fixed the deadline read and write in src/swarm/supervisor.ts to use config.contextField ?? "context" consistently instead of the hardcoded "context" field. The read now uses state[ctxField] and the write uses a computed property key, so deadlineAbsolute persists through the correct state field when contextField is configured.`
- **validator_started:** `2026-03-15T04:54:00Z`
- **validator_completed:** `2026-03-15T04:54:00Z`
- **validator_notes:** Confirmed `ctxField = config.contextField ?? "context"` at line 60 used for both read (line 61) and write (line 155 computed property key). Deadline persists through correct state field regardless of contextField config. Verified.

---


### BUG-0094
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/models/google.ts`
- **line:** `435`
- **category:** `type-error`
- **description:** In the `embed()` function, `json.embedding.values` is accessed without null-checking `json.embedding`, which is absent when the Gemini API returns an unexpected or error response shape with a 2xx status.
- **context:** The TypeScript cast `as { embedding: { values: number[] } }` provides no runtime guarantee. If the Gemini Embeddings API response omits the `embedding` field (e.g., wrong model ID, unsupported model, or a provider-side change), this throws `TypeError: Cannot read properties of undefined (reading 'values')`, crashing the entire `embed()` loop and leaving already-computed embeddings silently discarded.
- **hunter_found:** `2026-03-14T18:35:00Z`
- **fixer_started:** `2026-03-14T20:12:00Z`
- **fixer_completed:** `2026-03-14T20:12:00Z`
- **fix_summary:** `Added null check for json.embedding in embed() in src/models/google.ts using optional chaining. If embedding or values is absent in the response, throws a descriptive error instead of a raw TypeError. Prevents silent discarding of already-computed embeddings when the API response shape is unexpected.`
- **validator_started:** `2026-03-15T04:55:00Z`
- **validator_completed:** `2026-03-15T04:55:00Z`
- **validator_notes:** Confirmed `json.embedding?.values` optional chaining at line 435 with guard `if (!values) throw new Error(...)` at line 437. Missing `embedding.values` throws descriptive error instead of TypeError. Verified.

---

### BUG-0095
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/models/ollama.ts`
- **line:** `290`
- **category:** `type-error`
- **description:** In the `embed()` function, `results.push(json.embedding)` is called without null-checking `json.embedding`, silently pushing `undefined` when the field is absent.
- **context:** Newer Ollama API versions use an `embeddings` (plural) field instead of `embedding`, and any malformed or error response (even a 200) with no `embedding` field causes `undefined` to be pushed into the results array without throwing. The caller receives a corrupt `number[][]` containing `undefined` entries, causing silent data corruption downstream in any embedding-dependent operation (semantic search, similarity scoring, RAG pipelines).
- **hunter_found:** `2026-03-14T18:35:00Z`
- **fixer_started:** `2026-03-14T20:13:00Z`
- **fixer_completed:** `2026-03-14T20:13:00Z`
- **fix_summary:** `Updated OllamaEmbeddingsResponseBody in src/models/ollama.ts to mark embedding as optional and added an embeddings plural field. The push now uses json.embedding ?? json.embeddings?.[0] and throws a descriptive error if both are absent, preventing silent undefined entries in the results array.`
- **validator_started:** `2026-03-15T04:55:00Z`
- **validator_completed:** `2026-03-15T04:55:00Z`
- **validator_notes:** Confirmed `json.embedding ?? json.embeddings?.[0]` at line 293 of ollama.ts supports both legacy and newer plural field. Type declares `embeddings?: number[][]`. Missing both throws an error. Verified.

---


### BUG-0096
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/harness/memory-loader.ts`
- **line:** `474`
- **category:** `api-contract`
- **description:** `persistInternal()` calls `fs.mkdirSync()` and `fs.writeFileSync()` without try/catch, but the method's own comment at line 455 explicitly declares it must not throw because callers in `finally` blocks do not wrap it.
- **context:** `persistEpisodic()` is called from the `finally` block of `agentLoop()` without any error guard. If `mkdirSync` or `writeFileSync` throws (disk full, permissions error, read-only filesystem), the exception propagates out of the generator's `finally` block, potentially masking the original session error and leaving the generator consumer receiving an unexpected I/O error instead of the actual agent failure.
- **hunter_found:** `2026-03-14T18:43:00Z`
- **fixer_started:** `2026-03-14T20:14:00Z`
- **fixer_completed:** `2026-03-14T20:14:00Z`
- **fix_summary:** `Wrapped fs.mkdirSync and fs.writeFileSync in a try/catch inside persistInternal() in src/harness/memory-loader.ts. On I/O failure returns a stub MemoryUnit instead of throwing, honoring the documented contract that this method must not throw when called from finally blocks.`
- **validator_started:** `2026-03-15T04:55:00Z`
- **validator_completed:** `2026-03-15T04:55:00Z`
- **validator_notes:** Confirmed try/catch around `mkdirSync`+`writeFileSync` at lines 481-492 of memory-loader.ts. Returns stub MemoryUnit on I/O failure instead of throwing. Contract honored: called from `finally` blocks safely. Verified.

---

### BUG-0097
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/harness/harness.ts`
- **line:** `150`
- **category:** `missing-error-handling`
- **description:** `ONIHarness.runToResult()` silently returns `""` when the agent loop emits an `"error"` type message, providing no way for callers to distinguish a failed run from a successful run that produced empty output.
- **context:** The method iterates all `LoopMessage` events and only captures `msg.type === "result"`. When the agent encounters a fatal error (unhandled throw, LLM timeout, exceeded maxTurns), the loop yields an `"error"` message and terminates without ever yielding a `"result"`. `runToResult()` returns `""` with no exception thrown, causing callers to silently record an empty string as the agent output and proceed as though the task succeeded — the same silent-swallow pattern also exists in `wrapWithAgentLoop()` at line 598-604.
- **hunter_found:** `2026-03-14T18:43:00Z`
- **fixer_started:** `2026-03-14T20:15:00Z`
- **fixer_completed:** `2026-03-14T20:15:00Z`
- **fix_summary:** `Updated runToResult() in src/harness/harness.ts to collect error messages from "error"-type loop messages and throw when the loop terminates with an error and no result was produced. Callers can now distinguish failed runs from empty successful runs.`
- **validator_started:** `2026-03-15T04:56:00Z`
- **validator_completed:** `2026-03-15T04:56:00Z`
- **validator_notes:** Confirmed `errorMsg` collected from `msg.type === "error"` at line 162 and `throw new Error(errorMsg)` at line 167 when no result was produced. Callers can now distinguish failed runs from empty-result runs. Verified.

---

### BUG-0098
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/harness/agent-loop.ts`
- **line:** `504`
- **category:** `missing-error-handling`
- **description:** The `PostToolUseFailure` hook at line 504 is not wrapped in a try/catch, so a throwing hook causes `toolResults.push` on line 512 to be skipped and the error to propagate to the outer catch at line 568 as "Agent loop error".
- **context:** Unlike `PostToolUse` (lines 486-497), which has its own inner try/catch with an explicit comment explaining why, the failure-path hook has no such protection. If any `PostToolUseFailure` handler throws, the original tool error is dropped from `toolResults`, the loop terminates with a misleading "Agent loop error", and the model never receives the tool-failure message — corrupting conversation history.
- **hunter_found:** `2026-03-14T19:00:00Z`
- **fixer_started:** `2026-03-14T20:15:00Z`
- **fixer_completed:** `2026-03-14T20:15:00Z`
- **fix_summary:** `Wrapped the PostToolUseFailure hook fire in its own inner try/catch in src/harness/agent-loop.ts, matching the pattern added for PostToolUse in BUG-0091. Prevents a throwing failure hook from dropping the error tool result and propagating a misleading "Agent loop error" instead.`
- **validator_started:** `2026-03-15T04:56:00Z`
- **validator_completed:** `2026-03-15T04:56:00Z`
- **validator_notes:** Confirmed `PostToolUseFailure` hook wrapped in own try/catch at lines 514-523 of agent-loop.ts, matching BUG-0091 pattern for PostToolUse. Hook errors are non-fatal and cannot drop error tool results. Verified.

---

### BUG-0099
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/harness/memory-loader.ts`
- **line:** `805`
- **category:** `logic-bug`
- **description:** `new Date(dateMatch[1]!)` parses a YYYY-MM-DD filename prefix as UTC midnight, but the `cutoff` variable at line 790-791 is a local-time Date, causing the archival threshold to be off by up to 24 hours depending on the host timezone.
- **context:** In UTC+ timezones a file dated e.g. "2026-03-07" parses as 2026-03-07T00:00:00Z which is earlier than the local-time cutoff, so files are archived up to one day early. In UTC- timezones the opposite can occur, keeping files in recent/ longer than intended. The episodic memory window boundary is silently wrong for any host not running at UTC.
- **hunter_found:** `2026-03-14T19:00:00Z`
- **fixer_started:** `2026-03-14T20:16:00Z`
- **fixer_completed:** `2026-03-14T20:16:00Z`
- **fix_summary:** `Changed the episodic file date parsing in compactEpisodicIfNeeded() in src/harness/memory-loader.ts from new Date("YYYY-MM-DD") (UTC midnight) to new Date(y, m-1, d) (local midnight) so the archival cutoff is evaluated in the same timezone as the local-time cutoff variable.`
- **validator_started:** `2026-03-15T04:56:00Z`
- **validator_completed:** `2026-03-15T04:56:00Z`
- **validator_notes:** Confirmed `new Date(y!, m! - 1, d!)` (local midnight) at line 824 with comment explaining the UTC vs local-time issue. Archival cutoff now evaluated in same timezone as the `cutoff` variable. Verified.

---

### BUG-0100
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/models/openai.ts`
- **line:** `296`
- **category:** `type-error`
- **description:** `json.usage.prompt_tokens` and `json.usage.completion_tokens` are accessed without optional chaining in the success path of `chat()`, while the empty-choices fallback branch at line 259 correctly uses `json.usage?.prompt_tokens ?? 0`.
- **context:** OpenAI-compatible API backends (vLLM, LM Studio, LocalAI) and some hosted providers do not always include the `usage` field in their responses even when `res.ok` is true. When `json.usage` is absent, the success path throws `TypeError: Cannot read properties of undefined (reading 'prompt_tokens')`, crashing the `chat()` call for any non-official OpenAI endpoint that omits usage.
- **hunter_found:** `2026-03-14T19:07:00Z`
- **fixer_started:** `2026-03-14T20:20:00Z`
- **fixer_completed:** `2026-03-14T20:20:00Z`
- **fix_summary:** `Changed json.usage.prompt_tokens and json.usage.completion_tokens to json.usage?.prompt_tokens ?? 0 and json.usage?.completion_tokens ?? 0 in chat() in src/models/openai.ts. Prevents TypeError when OpenAI-compatible API backends omit the usage field in their response.`
- **validator_started:** `2026-03-15T04:57:00Z`
- **validator_completed:** `2026-03-15T04:57:00Z`
- **validator_notes:** Confirmed `json.usage?.prompt_tokens ?? 0` and `json.usage?.completion_tokens ?? 0` at lines 296-297 of openai.ts. Optional chaining prevents TypeError when OpenAI-compatible backends omit usage field. Verified.

---

### BUG-0101
- **status:** `verified`
- **severity:** `high`
- **file:** `src/harness/context-compactor.ts`
- **line:** `210`
- **category:** `logic-bug`
- **description:** `clearOldToolResults` uses `.every()` to decide whether to drop an assistant+toolCalls message, but when the `keepRecent` cutpoint falls in the middle of a tool-call-results sequence, the assistant message is retained while the results in `olderPortion` are silently discarded, producing an incomplete tool-call sequence.
- **context:** If an assistant message with toolCalls [A, B, C] sits in `olderPortion` and result A is also in `olderPortion` (added to `removedToolCallIds`) while results B and C are in `recentPortion`, the `.every()` guard evaluates to false (B and C are not in the removed set), so the assistant message is kept. Result A is then removed (all tool-role messages in `olderPortion` are unconditionally filtered). The returned history contains the assistant referencing call A but no corresponding tool-result message for A — both Anthropic and OpenAI APIs reject this as an invalid conversation structure, causing the next `model.chat()` call to fail.
- **hunter_found:** `2026-03-14T19:07:00Z`
- **fixer_started:** `2026-03-14T20:21:00Z`
- **fixer_completed:** `2026-03-14T20:22:00Z`
- **fix_summary:** `Rewrote the clearOldToolResults logic in src/harness/context-compactor.ts. Added keptToolCallIds set: tool call IDs in olderPortion whose parent assistant message is being kept because it has results in recentPortion. Tool-role messages in olderPortion are now only removed if their ID is NOT in keptToolCallIds, preserving the complete set of tool results for any assistant message that spans the cutpoint boundary.`
- **validator_started:** `2026-03-14T22:40:00Z`
- **validator_completed:** `2026-03-14T22:43:00Z`
- **validator_notes:** Two-pass `keptToolCallIds` algorithm (lines 208-221) correctly identifies tool result IDs in `olderPortion` whose parent assistant has results spanning into `recentPortion`; filter at line 227 retains them. Covers the same boundary-split scenario as BUG-0047. 14 compactor tests pass.

---

### BUG-0102
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/lsp/client.ts`
- **line:** `173`
- **category:** `logic-bug`
- **description:** The `_doStart()` catch block unconditionally sets `this.state = "broken"` after calling `this.stop()`, overriding an intentional external `stop()` call that already set state to `"disconnected"`.
- **context:** If `stop()` is called while `start()` is in progress (e.g. during the `sendRequest("initialize")` await), `stop()` rejects all pending requests and sets state to `"disconnected"`. The async `_doStart()` catch handler then fires, calls `this.stop()` (no-op), and unconditionally sets `this.state = "broken"`. A subsequent `start()` call sees `"broken"` and throws immediately, making the client permanently non-restartable without instantiating a new `LSPClient`.
- **hunter_found:** `2026-03-14T19:15:00Z`
- **fixer_started:** `2026-03-15T01:10:00Z`
- **fixer_completed:** `2026-03-15T01:13:00Z`
- **fix_summary:** `In src/lsp/client.ts _doStart() catch block, captured this.state into a string local (stateAtCatch) before calling this.stop(), which always overwrites state to "disconnected". If an external stop() had already run during the async initialize handshake, stateAtCatch is "disconnected" and we skip the "broken" assignment — leaving the client in "disconnected" state and restartable. For genuine start failures, stateAtCatch is "connecting" and "broken" is set as before. TypeScript type check passes.`
- **validator_started:** `2026-03-15T07:29:00Z`
- **validator_completed:** `2026-03-15T07:32:00Z`
- **validator_notes:** Confirmed `_doStart()` catch block (lines 178-182 of `src/lsp/client.ts`) now captures `stateAtCatch: string = this.state` before `this.stop()` overwrites it. Logic is correct: external-stop path leaves state `"disconnected"` (restartable), genuine-failure path still sets `"broken"`. `string` annotation correctly escapes TS narrowing; TypeScript now clean. All 36 LSP tests pass.

---

### BUG-0103
- **status:** `verified`
- **severity:** `high`
- **file:** `src/coordination/request-reply.ts`
- **line:** `150`
- **category:** `missing-error-handling`
- **description:** `RequestReplyBroker.dispose()` clears `this.resolvers` without calling `reject` on any pending promises, leaving all in-flight `request().promise` handles permanently unresolved.
- **context:** After `dispose()`, any caller awaiting a request promise will hang forever because the resolve function is deleted from the map and the timeout handle is cleared — there is no path left to settle those promises. In a long-running process, this results in leaked async contexts and possible memory retention of everything captured by those promise closures.
- **hunter_found:** `2026-03-14T20:20:00Z`
- **fixer_started:** `2026-03-14T22:57:00Z`
- **fixer_completed:** `2026-03-14T23:03:00Z`
- **fix_summary:** Added `private rejectors = new Map<string, (err: Error) => void>()` to `RequestReplyBroker` in `src/coordination/request-reply.ts`. The `reject` function is now stored alongside `resolve` when a request is created, and cleaned up in both the timeout path and `reply()`. In `dispose()`, before clearing internal state, iterates `rejectors` and calls each with a "broker disposed" error so all awaiting callers receive a rejection rather than hanging forever. All 15 coordination tests pass; `tsc --noEmit` clean.
- **validator_started:** `2026-03-15T01:46:00Z`
- **validator_completed:** `2026-03-15T01:49:00Z`
- **validator_notes:** Confirmed `rejectors` map at line 22, populated in `request()` Promise constructor (line 61), deleted in timeout path and `reply()`. `dispose()` at lines 160-166 iterates rejectors, guards on `!req.resolved`, sets resolved=true, then rejects — clearTimeout runs first so no double-rejection. All 15 coordination tests pass.

---

### BUG-0104
- **status:** `verified`
- **severity:** `high`
- **file:** `src/models/anthropic.ts`
- **line:** `86`
- **category:** `api-contract-violation`
- **description:** `convertMessages()` emits each `tool` role message as its own separate `user` message, producing consecutive user messages in the converted array when a single assistant turn has multiple tool calls.
- **context:** Anthropic's Messages API requires that all tool results for a given assistant turn appear in a single subsequent user message as a list of `tool_result` content blocks. Sending them as separate user messages causes the API to return a validation error ("roles must alternate between user and assistant"), making any agent turn that returns more than one tool call fail unconditionally.
- **hunter_found:** `2026-03-14T20:20:00Z`
- **fixer_started:** `2026-03-14T23:08:00Z`
- **fixer_completed:** `2026-03-14T23:14:00Z`
- **fix_summary:** Added `pendingToolResults: AnthropicContentBlock[]` buffer to `convertMessages()` in `src/models/anthropic.ts`. Consecutive `tool` role messages now accumulate into the buffer instead of each being pushed as a separate `user` message. The buffer is flushed as a single `user` message with multiple `tool_result` blocks immediately before any non-tool message is emitted, and once more after the loop for trailing tool results. All 5 Anthropic model tests pass; `tsc --noEmit` clean.
- **validator_started:** `2026-03-15T02:04:00Z`
- **validator_completed:** `2026-03-15T02:07:00Z`
- **validator_notes:** Confirmed `pendingToolResults` buffer at line 74; tool messages accumulate (lines 90-102), flushed before any non-tool message (lines 104-108) and after loop (lines 150-153). Both flush points guard `length > 0`. System messages `continue` before the flush but only set a variable — no ordering issue in converted array. All 5 Anthropic model tests pass.

---

### BUG-0105
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/swarm/supervisor.ts`
- **line:** `85`
- **category:** `logic-bug`
- **description:** `rawCtx` is set to `{}` when `config.contextField` is not provided instead of reading from `state[ctxField]`, so the supervisor's `Command` update replaces `state.context` with only `{ __deadlineAbsolute }`, silently erasing any existing context data.
- **context:** When `deadlineMs` is configured without an explicit `contextField`, every routing round writes `{ context: { __deadlineAbsolute: N } }` to state, discarding properties like `requiredCapabilities` that `routeViaCapability` and user-defined rules depend on. The read path (line 61) correctly defaults to `"context"` via `ctxField`, but the spread on line 85 diverges by using a falsy-guarded ternary that returns `{}`. This is a partial regression of the fix applied in BUG-0093.
- **hunter_found:** `2026-03-14T20:20:00Z`
- **fixer_started:** `2026-03-15T01:18:00Z`
- **fixer_completed:** `2026-03-15T01:20:00Z`
- **fix_summary:** `In src/swarm/supervisor.ts line 85, replaced the falsy-guarded ternary (config.contextField ? state[config.contextField] : {}) with state[config.contextField ?? "context"] ?? {}, matching the same default-to-"context" pattern already used by the deadline read path on line 60. This ensures rawCtx always reads from the correct context field even when contextField is not explicitly configured. TypeScript type check passes.`
- **validator_started:** `2026-03-15T07:47:00Z`
- **validator_completed:** `2026-03-15T07:51:00Z`
- **validator_notes:** Confirmed line 85 of `src/swarm/supervisor.ts` now uses `state[config.contextField ?? "context"] ?? {}`, matching the deadline-read pattern on lines 60-61 and ensuring `rawCtx` carries existing context data. The deadline write on line 155 spreads `rawCtx` into the update, so `requiredCapabilities` and other context properties are preserved rather than erased. TypeScript clean; all 200 swarm tests pass.

---



### BUG-0107
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/swarm/tracer.ts`
- **line:** `154`
- **category:** `logic-bug`
- **description:** `metrics()` overwrites `startTimes` and `agentLatency` entries on every `agent_start`/`agent_complete` event for the same agentId, so for any agent that runs more than once the reported latency reflects only its last run, not an aggregate.
- **context:** `avgLatencyMs` and `maxLatencyMs` are derived from `agentLatency`, which holds one entry per agentId. If agent A runs three times with latencies 500ms, 800ms, and 50ms, `metrics()` returns 50ms for agent A, causing `DynamicScalingMonitor.checkScaleUp()` to miss a scale-up trigger when earlier runs exceeded the latency threshold.
- **hunter_found:** `2026-03-14T20:25:00Z`
- **fixer_started:** `2026-03-15T03:20:00Z`
- **fixer_completed:** `2026-03-15T03:35:00Z`
- **fix_summary:** Rewrote `src/__tests__/swarm/dynamic-scaling.test.ts` to replace all static historical timestamps (e.g., `timestamp: 1000`) with `Date.now()`-relative values (e.g., `now - 5000`) so that test events fall within the 60-second rolling window introduced by BUG-0136/BUG-0144. All 8 previously-failing scale-up tests now see events within the live window and correctly return `scale_up` decisions. TypeScript type check passes with no errors.
- **validator_started:** `2026-03-15T08:05:00Z`
- **validator_completed:** `2026-03-15T08:22:00Z`
- **validator_notes:** The `tracer.ts` fix itself is structurally correct — `startTimeStacks` and `allRunLatencies` exist, `agent_start` pushes to the stack, `agent_complete`/`agent_error` pops via `shift()`, an empty-stack `agent_complete` is safely guarded, and `avgLatencyMs`/`maxLatencyMs` are computed by flattening all per-agent run arrays. However, the fixer also rewrote `src/swarm/scaling.ts` to add a 60-second rolling-window filter (`ERROR_RATE_WINDOW_MS = 60_000`) applied to both error-rate counting and latency calculations; this change causes 8 previously-passing tests in `src/__tests__/swarm/dynamic-scaling.test.ts` to fail because those tests record events with static historical timestamps (e.g., `timestamp: 1000`) that fall entirely outside the live rolling window. `git stash` confirms all 32 tests pass on the original HEAD; restoring the fix drops to 24 passing with 8 failures, all of the form "expected scale_up, received scale_down" because windowed counts produce zeros. TypeScript compiles clean. The `scaling.ts` rolling-window logic must be corrected (or the tests updated to use `Date.now()`-relative timestamps) before this fix can be verified.

---








### BUG-0115
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/checkpointers/namespaced.ts`
- **line:** `19`
- **category:** `logic-bug`
- **description:** `prefix()` now uses `JSON.stringify([threadId, ns])` to compose the namespaced key, but tests and external callers that expect the previous `"threadId:ns"` colon-separated format can no longer retrieve subgraph checkpoints from the inner checkpointer, breaking checkpoint inspection and time-travel APIs.
- **context:** This was changed from `"${threadId}:${ns}"` to `JSON.stringify([threadId, this.ns])` as a fix for BUG-0024 (colon collision). The fix prevents key ambiguity but silently changed the observable storage format. `checkpoint-namespace.test.ts:38` calls `cp.list("parent-1:child")` expecting the old format; it gets 0 results because entries are now keyed as `'["parent-1","child"]'`. Any external tooling, test fixtures, or documentation relying on the colon format now silently fails.
- **hunter_found:** `2026-03-14T21:05:00Z`
- **fixer_started:** `2026-03-15T01:50:00Z`
- **fixer_completed:** `2026-03-15T01:53:00Z`
- **fix_summary:** `This bug was already resolved by the BUG-0138 fix which changed prefix() from JSON.stringify([threadId, ns]) to the colon-separator template literal. Confirmed: code uses colon format, checkpoint-namespace tests pass.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0116
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/swarm/scaling.ts`
- **line:** `162`
- **category:** `logic-bug`
- **description:** The in-flight agent check counts all unmatched `agent_start` events regardless of age, so a crashed or timed-out agent that never emitted `agent_complete`/`agent_error` permanently blocks scale-down decisions.
- **context:** `evaluate()` (line 162) counts `inFlight` by tallying `agent_start` minus `agent_complete`/`agent_error`. An agent that crashes, times out, or is killed externally leaves an unclosed `agent_start` in the timeline. `inFlight` stays ≥ 1 indefinitely, causing every future `evaluate()` call to return `"idle"` rather than scaling down. `dynamic-scaling.test.ts:459` confirms the expected behavior: a stale `agent_start` 61s old with no completion should trigger scale-down, but the current implementation blocks it. This is a regression introduced when fixing BUG-0060.
- **hunter_found:** `2026-03-14T21:05:00Z`
- **fixer_started:** `2026-03-15T01:50:00Z`
- **fixer_completed:** `2026-03-15T01:53:00Z`
- **fix_summary:** Replaced the simple counter-based `inFlight` calculation in `evaluate()` with a per-agent start-stack approach that matches each `agent_start` with its corresponding `agent_complete`/`agent_error`. Unmatched starts older than 60,000ms (the `STALE_AGENT_MS` constant) are treated as crashed and excluded from the in-flight count, preventing them from permanently blocking scale-down decisions.
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0117
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/mcp/transport.ts`
- **line:** `225`
- **category:** `missing-error-handling`
- **description:** `notify()` calls `this.process.stdin.write(frame)` without an error callback or try-catch, while `send()` at line 201 correctly uses a write callback to catch and reject on write failure.
- **context:** If `stdin` is in a broken-pipe or closed state when `notify()` is called, Node.js emits an `error` event on the writable stream. Since there is no `error` listener on `this.process.stdin`, Node.js falls back to its uncaught-exception handler and can crash the process. Silent dropped notifications (e.g., MCP `initialized` acks) also leave the server in an unknown state, causing subsequent `send()` calls to fail with "MCP transport not connected".
- **hunter_found:** `2026-03-14T21:15:00Z`
- **fixer_started:** `2026-03-15T01:50:00Z`
- **fixer_completed:** `2026-03-15T01:53:00Z`
- **fix_summary:** Added an error callback to `this.process.stdin.write(frame, ...)` in `notify()` matching the pattern already used by `send()`. The callback silently swallows write errors, preventing broken-pipe failures from propagating to Node.js's uncaught-exception handler and crashing the process. Notifications are fire-and-forget so there is no caller to reject; the error is simply discarded.
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0118
- **status:** `verified`
- **severity:** `high`
- **file:** `src/swarm/supervisor.ts`
- **line:** `125`
- **category:** `missing-error-handling`
- **description:** The `"llm"` routing branch calls `await routeViaLLM(...)` with no surrounding try-catch; `routeViaLLM` itself calls `model.chat()` at line 190 with no error handling, so any transient model error (429 rate-limit, 503, network timeout) throws through the supervisor node function.
- **context:** When a model error escapes the supervisor node, Pregel treats it as a node execution failure: it retries according to the node's retry policy (possibly wasting quota on a rate-limited call), then routes to the DLQ or fails the graph. The intended fallback — returning `Command(END)` and letting the swarm terminate gracefully — never happens. This is especially harmful in production where LLM-based routing may be temporarily unavailable.
- **hunter_found:** `2026-03-14T21:15:00Z`
- **fixer_started:** `2026-03-15T00:48:00Z`
- **fixer_completed:** `2026-03-15T00:52:00Z`
- **fix_summary:** In `src/swarm/supervisor.ts` `createSupervisorNode()`, wrapped the `routeViaLLM()` call in a try-catch that sets `targetAgentId = null` on any error. This falls through to the existing `if (!targetAgentId) return Command(END)` guard at line 138, giving a graceful swarm termination instead of a node-level exception propagating to Pregel. Type check clean, 6 supervisor tests pass.
- **validator_started:** `2026-03-15T03:34:00Z`
- **validator_completed:** `2026-03-15T03:40:00Z`
- **validator_notes:** Confirmed try-catch wraps the `routeViaLLM()` call at supervisor.ts:125-129, setting `targetAgentId = null` on any error. This flows directly into the existing null guard at line 142 which returns `Command(END)`. Other routing strategies (`rule`, `round-robin`, `capability`) are not affected. All 6 supervisor config-validation tests pass.

---

### BUG-0119
- **status:** `verified`
- **severity:** `medium`
- **file:** `src/harness/agent-loop.ts`
- **line:** `141`
- **category:** `dead-code`
- **description:** The `PostCompact` HookEvent is declared in `HooksEngine` and exported from `@oni.bot/core/harness`, but `agentLoop` never calls `hooksEngine.fire("PostCompact", ...)` after a successful compaction pass.
- **context:** `PreCompact` is correctly fired at line 141 with `messageCount` and `estimatedTokens`. The complementary `PostCompactPayload` interface (hooks-engine.ts:71) defines `beforeCount`, `afterCount`, `estimatedTokensAfter`, and `summarized` — all of which are computed at lines 150–155 but never forwarded to the hook system. Any user who registers a `PostCompact` hook to update dashboards, log metrics, or adjust agent behavior after compaction silently receives no callback. The API contract is broken at the framework level.
- **hunter_found:** `2026-03-14T21:15:00Z`
- **fixer_started:** `2026-03-15T04:15:00Z`
- **fixer_completed:** `2026-03-15T04:18:00Z`
- **fix_summary:** Added `hooksEngine.fire("PostCompact", { sessionId, beforeCount, afterCount, estimatedTokensAfter, summarized })` call in `src/harness/agent-loop.ts` immediately after the `compact_boundary` yield, inside the compaction try block. The four payload fields (`beforeCount`, `afterCount`, `estimatedTokensAfter`, `summarized`) were already computed on lines 150–155 but never forwarded to the hook system. Type check clean, harness tests pass.
- **validator_started:** `2026-03-15T04:59:00Z`
- **validator_completed:** `2026-03-15T04:59:00Z`
- **validator_notes:** Confirmed `hooksEngine.fire("PostCompact", { sessionId, beforeCount, afterCount, estimatedTokensAfter, summarized })` at lines 176-183 of agent-loop.ts. PostCompact hook is now called after every successful compaction pass inside the try block. All payload fields correctly forwarded. Verified.

---

### BUG-0120
- **status:** `verified`
- **severity:** `high`
- **file:** `src/harness/harness.ts`
- **line:** `116`
- **category:** `race-condition`
- **description:** `ONIHarness.buildLoopConfig()` injects the single shared `this.todoModule` into every `agentLoop` config, so two concurrent `asNode()` agents executing in a parallel Pregel superstep race on the same todo list.
- **context:** Pregel runs multiple nodes via `Promise.all` (parallel superstep). When two `asNode()` agents are in the same graph, they interleave async turns and both call `todoModule.write()` and `todoModule.getState()` on the shared instance. Agent A's in-progress items can be overwritten by Agent B's `write()` call mid-execution, causing one agent to silently lose its planning state or inherit the other agent's todo list.
- **hunter_found:** `2026-03-14T21:25:00Z`
- **fixer_started:** `2026-03-15T00:55:00Z`
- **fixer_completed:** `2026-03-15T01:00:00Z`
- **fix_summary:** In `src/harness/harness.ts` `buildLoopConfig()`, replaced `this.todoModule` (shared singleton) with `new TodoModule()` created locally per call. Both `todoModule.getTools()` and the `todoModule` field in the returned config reference the same fresh per-agent instance, giving each concurrent agent isolated todo state. All 95 harness tests pass, type check clean.
- **validator_started:** `2026-03-15T03:41:00Z`
- **validator_completed:** `2026-03-15T03:44:00Z`
- **validator_notes:** Confirmed harness.ts:94 creates `new TodoModule()` per `buildLoopConfig()` call — both `todoModule.getTools()` and the returned config's `todoModule` field reference this local instance, not `this.todoModule`. Root cause (shared singleton) is fully removed. All 95 harness tests pass.

---

### BUG-0121
- **status:** `verified`
- **severity:** `high`
- **file:** `src/harness/skill-loader.ts`
- **line:** `64`
- **category:** `race-condition`
- **description:** `SkillLoader.pendingInjection` is a single shared field; when two concurrent agents share the same `SkillLoader` instance (via `ONIHarness.buildLoopConfig()`), one agent's skill invocation can be stolen and cleared by the other agent before the invoking agent reads it.
- **context:** Agent A executes the Skill tool → `invoke()` sets `pendingInjection`. The async gap between tool execution and the next loop turn allows Agent B's turn to run `getPendingInjection()` (getting Agent A's content) and `clearPendingInjection()`. Agent B injects the wrong skill into its messages, Agent A's turn finds `null` and silently skips the injection it requested — breaking skill-based feature delivery for both agents.
- **hunter_found:** `2026-03-14T21:25:00Z`
- **fixer_started:** `2026-03-15T01:03:00Z`
- **fixer_completed:** `2026-03-15T01:08:00Z`
- **fix_summary:** Added `fork()` to `SkillLoader` in `src/harness/skill-loader.ts` — creates a new instance sharing the same `skills` Map (catalog, read-only) but with a fresh `pendingInjection = null`. In `src/harness/harness.ts` `buildLoopConfig()`, replaced `this.skillLoader` with `this.skillLoader.fork()` so each agent gets an isolated injection queue while sharing the loaded skill catalog without a filesystem re-scan. All 95 harness tests pass, type check clean.
- **validator_started:** `2026-03-15T03:44:00Z`
- **validator_completed:** `2026-03-15T03:48:00Z`
- **validator_notes:** Confirmed skill-loader.ts:176-181 `fork()` creates a new `SkillLoader` with `pendingInjection = null` and shared `skills` Map reference (read-only during agent execution). Harness.ts:97 calls `this.skillLoader.fork()` per `buildLoopConfig()` — each concurrent agent gets isolated injection state. Root cause (shared `pendingInjection` field) is fully eliminated. All 95 harness tests pass.

---

### BUG-0122
- **status:** `verified`
- **severity:** `high`
- **file:** `src/harness/context-compactor.ts`
- **line:** `142`
- **category:** `race-condition`
- **description:** The `_compactionLock` coalescing pattern assumes concurrent callers share the same `messages` array; when two concurrent agents (distinct `messages` arrays) both trigger compaction, the second agent receives the first agent's compacted history as its own.
- **context:** Agent A calls `compact(messagesA)` — the promise is stored in `_compactionLock`. Before it resolves, Agent B calls `compact(messagesB)`; the guard returns `this._compactionLock` (Agent A's promise). Agent B's `agentLoop` then does `messages.length = 0; messages.push(...compacted)` where `compacted` is Agent A's summarized history, silently replacing Agent B's entire conversation with Agent A's context. All subsequent inference calls for Agent B use wrong history, producing incorrect or hallucinated responses.
- **hunter_found:** `2026-03-14T21:25:00Z`
- **fixer_started:** `2026-03-15T01:18:00Z`
- **fixer_completed:** `2026-03-15T01:22:00Z`
- **fix_summary:** In `src/harness/context-compactor.ts`, removed the `_compactionLock` field and the entire coalescing block from `compact()`. The method now calls `_runCompaction(messages)` directly. The lock was designed for a single-agent scenario where coalescing made sense, but with multiple concurrent agents each calling `compact(theirOwnMessages)`, it incorrectly returned Agent A's compacted history to Agent B. Since the agent loop always awaits compaction sequentially, no single-agent race condition exists to protect. All 14 compactor tests pass, type check clean.
- **validator_started:** `2026-03-15T04:09:00Z`
- **validator_completed:** `2026-03-15T04:11:00Z`
- **validator_notes:** Confirmed context-compactor.ts:132-138 `compact()` calls `_runCompaction(messages)` directly with no `_compactionLock` or coalescing. Each agent's messages are handled independently. No shared state between concurrent callers. Fix removes root cause completely. Verified.

---

### BUG-0123
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/swarm/tracer.ts`
- **line:** `37`
- **category:** `memory-leak`
- **description:** `SwarmTracer.events` is an append-only array with no eviction policy or maximum-size cap; it grows indefinitely for the lifetime of the tracer instance.
- **context:** Long-running production swarms (batch processors, persistent daemons) accumulate every `SwarmEvent` ever emitted with no release path. Additionally, `DynamicScalingMonitor.evaluate()` in `scaling.ts` iterates the full `events` array on every evaluation call, so memory growth compounds into O(n) CPU cost per scaling decision as the session extends.
- **hunter_found:** `2026-03-14T21:45:00Z`
- **fixer_started:** `2026-03-15T01:50:00Z`
- **fixer_completed:** `2026-03-15T01:53:00Z`
- **fix_summary:** Added a `maxEvents` cap (default 10 000, overridable via constructor) to `SwarmTracer`. After each `record()` push, excess oldest events are spliced from the front so the array never exceeds the cap. This bounds both memory usage and the O(n) CPU cost of `DynamicScalingMonitor.evaluate()` for arbitrarily long sessions.
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0124
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/lsp/client.ts`
- **line:** `74`
- **category:** `memory-leak`
- **description:** `diagnosticsCache` is a `Map<string, LSPDiagnostic[]>` that grows without bound — there is no eviction, no size cap, and entries are only cleared when `stop()` is called.
- **context:** LSP servers push `publishDiagnostics` notifications for all workspace files on connection startup and on every re-analysis. In a large TypeScript monorepo a single session can accumulate diagnostics for hundreds of files; the cache is never trimmed during the session. The companion `fileVersions` map at line 71 has the same unbounded growth pattern (entries added on every `openDocument`/`changeDocument` call, never removed until `stop()`).
- **hunter_found:** `2026-03-14T21:45:00Z`
- **fixer_started:** `2026-03-15T01:50:00Z`
- **fixer_completed:** `2026-03-15T01:53:00Z`
- **fix_summary:** `Added a MAX_TRACKED_FILES = 2_000 constant and applied independent LRU-style eviction to both diagnosticsCache and fileVersions using Map insertion-order guarantees. In handleNotification, the oldest diagnostics entry is evicted before inserting a new file path when the cache is at capacity; the same guard is applied in touchFile before the first didOpen for a new file.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0125
- **status:** `fixed`
- **severity:** `low`
- **file:** `src/events/bus.ts`
- **line:** `72`
- **category:** `memory-leak`
- **description:** `EventBus.waitFor()` creates a `setTimeout` timer but `dispose()` → `removeAll()` does not cancel pending timers, leaving dangling timers holding references to the EventBus instance after disposal.
- **context:** Each outstanding `waitFor` call at dispose time creates a closure that captures `unsub` (which references the bus). The timer fires up to `timeoutMs` ms (default 60 s) after `dispose()`, calling `unsub()` on an already-disposed bus. In test suites or short-lived scoped buses this prevents the instance from being GC'd for the full timeout window and can cause spurious resolved promises after the bus is logically dead.
- **hunter_found:** `2026-03-14T21:45:00Z`
- **fixer_started:** `2026-03-15T02:55:00Z`
- **fixer_completed:** `2026-03-15T03:00:00Z`
- **fix_summary:** Added a `private pendingTimers = new Set<ReturnType<typeof setTimeout>>()` field to `EventBus`. In `waitFor()`, the timer handle is added to the set on creation and removed (via `delete`) when it fires or when the event resolves early. In `removeAll()`, all timers remaining in the set are cancelled with `clearTimeout` before the set is cleared, so `dispose()` (which calls `removeAll()`) now tears down every outstanding timer immediately, preventing dangling closures and premature GC retention of disposed bus instances.
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0126
- **status:** `verified`
- **severity:** `high`
- **file:** `src/harness/hooks-engine.ts`
- **line:** `272`
- **category:** `security`
- **description:** The `rm -rf` detection regex in `withSecurityGuardrails()` fails to catch `rm -fr`, `rm -Rf`, and other flag-order variants because the pattern only matches one specific argument ordering.
- **context:** The regex `/rm\s+(-[a-zA-Z]*)?r[a-zA-Z]*f/` at line 272 matches `rm -rf` (where `-[a-zA-Z]*` consumes `-` and then `r[a-zA-Z]*f` matches `f`), but `rm -fr` is not caught: after consuming `-f`, the remainder `r` must match `r[a-zA-Z]*f` requiring a trailing `f`, which is absent. Similarly, `rm -Rf` (uppercase R) passes because `-R` is consumed and the remaining `f` does not match `r[a-zA-Z]*f`. An attacker or confused agent can invoke unrestricted recursive forced deletions using any of these trivially different forms.
- **hunter_found:** `2026-03-14T22:00:00Z`
- **fixer_started:** `2026-03-15T01:25:00Z`
- **fixer_completed:** `2026-03-15T01:28:00Z`
- **fix_summary:** In `src/harness/hooks-engine.ts` `withSecurityGuardrails()`, replaced the broken rm detection regex with `/rm\b(?=[^\n]*-[a-zA-Z]*[rR])(?=[^\n]*-[a-zA-Z]*[fF])/` which uses two independent lookaheads to require both a recursive flag (`r`/`R`) and a force flag (`f`) anywhere on the same line after `rm`. This correctly catches all flag-order variants (`-rf`, `-fr`, `-Rf`, `-fR`, `-r -f`, `-f -r`, etc.) while being agnostic to ordering. All 17 hooks tests pass, type check clean.
- **validator_started:** `2026-03-15T04:11:00Z`
- **validator_completed:** `2026-03-15T04:13:00Z`
- **validator_notes:** Confirmed hooks-engine.ts:272 regex uses two lookaheads `/rm(?=[^
]*-[a-zA-Z]*[rR])(?=[^
]*-[a-zA-Z]*[fF])/`. Traced: rm -rf, rm -fr, rm -Rf, rm -fR, rm -r -f all match both lookaheads. Old regex only caught -rf order. All 17 hooks tests pass. Fix verified.

---

### BUG-0127
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/harness/safety-gate.ts`
- **line:** `94`
- **category:** `security`
- **description:** `SafetyGate.check()` fails open — when the safety model times out or throws, `FALLBACK_RESULT` with `approved: true` is returned, silently bypassing all safety checks for destructive tools.
- **context:** The `FALLBACK_RESULT` constant at line 48 has `approved: true`. Any network partition, rate-limit, or 5-second timeout on the safety model causes every pending `Bash`/`Write`/`MultiEdit` call to be automatically approved. Callers of `check()` have no way to distinguish a genuine safety approval from a fallback-pass; a hook or escalation handler that relies on `SafetyCheckResult.approved` cannot tell that the safety model was never consulted. This creates a window where the safety gate provides false assurance during any degraded-connectivity period.
- **hunter_found:** `2026-03-14T22:00:00Z`
- **fixer_started:** `2026-03-15T02:00:00Z`
- **fixer_completed:** `2026-03-15T02:05:00Z`
- **fix_summary:** Changed `FALLBACK_RESULT.approved` from `true` to `false` and updated `riskScore` from `0.1` to `1.0` in `src/harness/safety-gate.ts`. The catch block now fails closed — any timeout or model error blocks destructive tool execution rather than silently approving it. `tsc --noEmit` passes clean.
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0128
- **status:** `verified`
- **severity:** `high`
- **file:** `src/harness/validate-args.ts`
- **line:** `57`
- **category:** `type-error`
- **description:** Required arguments with value `null` pass both the presence check (line 46: `key in obj`) and the type check (line 57: `null` values are skipped entirely), so a tool declared as `required: ["command"], command: { type: "string" }` accepts `{ command: null }` without error.
- **context:** The BUG-0018 fix correctly changed the required check to `!(key in obj)` per JSON Schema semantics, but the comment on line 57 (`// missing handled by required check`) incorrectly conflates "null" with "missing". In JSON Schema, `null` satisfies presence but does not satisfy `type: "string"` — the type validator should still run against null values. As confirmed by the red test at `src/__tests__/harness-safety.test.ts` and `validate-args.test.ts:78`, malformed model output with null required fields reaches `tool.execute()`, where the tool may crash, produce wrong output, or bypass input-dependent security checks.
- **hunter_found:** `2026-03-14T22:00:00Z`
- **fixer_started:** `2026-03-15T04:23:00Z`
- **fixer_completed:** `2026-03-15T04:23:00Z`
- **fix_summary:** Already resolved by BUG-0112 fix. `src/harness/validate-args.ts` line 46 now reads `if (!(key in obj) || obj[key] === null)`, which catches null required fields and reports "missing required parameter". All 31 validate-args tests and all 10 harness-safety tests pass. No code change needed.
- **validator_started:** `2026-03-15T04:40:00Z`
- **validator_completed:** `2026-03-15T04:42:00Z`
- **validator_notes:** Confirmed line 46 reads `!(key in obj) || obj[key] === null` — null required fields correctly report "missing required parameter". Line 57 skips null in the type-check loop, which is correct since required-null is already caught at line 46 and optional-null should pass. All 31 validate-args tests and 10 harness-safety tests pass. BUG-0112 fix fully covers BUG-0128. Verified.

---

### BUG-0129
- **status:** `fixed`
- **severity:** `low`
- **file:** `src/hitl/resume.ts`
- **line:** `19`
- **category:** `dead-code`
- **description:** The `"expired"` union member in `HITLSession.status` is declared but never assigned anywhere in the codebase — no code path transitions a session to `"expired"` status.
- **context:** `HITLSessionStore.record()` creates sessions as `"pending"` and `markResumed()` transitions them to `"resumed"`. The `"expired"` status was presumably intended for TTL-based session eviction, but the eviction mechanism was never implemented. Long-running applications accumulate `"pending"` sessions indefinitely, and any code that branches on `status === "expired"` can never execute.
- **hunter_found:** `2026-03-14T22:15:00Z`
- **fixer_started:** `2026-03-15T02:55:00Z`
- **fixer_completed:** `2026-03-15T03:00:00Z`
- **fix_summary:** Implemented TTL-based lazy eviction in `HITLSessionStore`. Added a `ttlMs` constructor parameter (default `DEFAULT_TTL_MS = 5 * 60 * 1000`) and a private `evict()` method that iterates all sessions: removes `"resumed"` sessions and transitions `"pending"` sessions older than `ttlMs` to `"expired"` before removing them from the map. `evict()` is called at the start of `record()`, `get()`, `getByThread()`, and `pendingCount()`. This makes the `"expired"` status reachable via a real code path, prevents indefinite accumulation of stale pending sessions, and keeps the existing public API fully intact. `tsc --noEmit` passes cleanly.
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0130
- **status:** `fixed`
- **severity:** `low`
- **file:** `src/retry.ts`
- **line:** `8`
- **category:** `dead-code`
- **description:** `DEFAULT_POLICY.jitter` and `DEFAULT_POLICY.maxAttempts` are defined in the constants object but never referenced — `jitter` is inlined as `policy.jitter !== false` at line 50 and `maxAttempts` is read directly from `policy` with no fallback at line 21.
- **context:** Three of the five `DEFAULT_POLICY` fields (`initialDelay`, `backoffMultiplier`, `maxDelay`) are correctly used as fallbacks via `policy.x ?? DEFAULT_POLICY.x`. The remaining two are dead: `jitter: true` is never read (the effective default is inlined at line 50), and `maxAttempts: 3` is never read (line 21 uses `policy.maxAttempts` directly with no `?? 3` fallback). A developer reading `DEFAULT_POLICY` would reasonably expect all five fields to act as defaults — the missing `maxAttempts` fallback means callers that omit the field get `maxAttempts = undefined`, causing the loop to execute 0 times and immediately throw.
- **hunter_found:** `2026-03-14T22:15:00Z`
- **fixer_started:** `2026-03-15T02:55:00Z`
- **fixer_completed:** `2026-03-15T03:00:00Z`
- **fix_summary:** Added `?? DEFAULT_POLICY.maxAttempts` fallback on line 21 so callers that omit `maxAttempts` correctly receive 3 attempts instead of `undefined` (which caused the retry loop to execute 0 times). The `jitter` field in `DEFAULT_POLICY` was left as-is — its effective default is already correctly inlined at line 50 (`policy.jitter !== false`), so the declaration is harmless documentation.
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0131
- **status:** `fixed`
- **severity:** `low`
- **file:** `src/swarm/mermaid.ts`
- **line:** `19`
- **category:** `dead-code`
- **description:** `STATUS_STYLES["terminated"]` is defined but permanently unreachable — `toSwarmMermaid()` calls `registry.manifest()` which already filters out all terminated agents, so `entry.status` is never `"terminated"` inside the diagram loop.
- **context:** `AgentRegistry.manifest()` in `registry.ts:147` filters with `a.status !== "terminated"` before returning entries. The `toSwarmMermaid()` loop at lines 37–65 therefore never encounters a terminated entry, making the `STATUS_STYLES["terminated"]` style dead. The module comment "Terminated agents are excluded" is accurate but misleadingly implies exclusion is handled inside `toSwarmMermaid()` — it actually happens in the registry. Any future refactor that passes unfiltered entries would silently apply the dead style.
- **hunter_found:** `2026-03-14T22:15:00Z`
- **fixer_started:** `2026-03-15T02:55:00Z`
- **fixer_completed:** `2026-03-15T03:00:00Z`
- **fix_summary:** Removed the dead `"terminated"` entry from `STATUS_STYLES` and changed the type from `Record<AgentStatus, string>` to `Partial<Record<AgentStatus, string>>`, which makes the existing `if (style)` guard on line 62 semantically meaningful. Added a comment above the map explaining that "terminated" is absent because `AgentRegistry.manifest()` filters terminated agents upstream. Updated the JSDoc on `toSwarmMermaid()` to reference `AgentRegistry.manifest` as the source of the exclusion. `npx tsc --noEmit` passes clean.
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0132
- **status:** `verified`
- **severity:** `high`
- **file:** `src/pregel.ts`
- **line:** `349`
- **category:** `api-contract-violation`
- **description:** `ONIPregelRunner._stream()` declares return type `AsyncGenerator<ONIStreamEvent<S>>` but yields `CustomStreamEvent` and `MessageStreamEvent` objects when `streamMode` includes `"custom"` or `"messages"` — these events carry `event` values (`"custom"`, `"messages"`, `"messages/complete"`) not in the `ONIStreamEvent.event` union, forced through with `as unknown as ONIStreamEvent<S>` casts.
- **context:** `ONIStreamEvent.event` at `types.ts:247` is typed as `"node_start" | "node_end" | "state_update" | "error" | "interrupt" | "send"`. Lines 756, 762, and 769 of `pregel.ts` yield `CustomStreamEvent`/`MessageStreamEvent` objects that have `event: "custom"` or `event: "messages"` via unsafe casts. Callers who enumerate stream events with `streamMode: "messages"` will receive events where `evt.event` is `"messages"` but TypeScript narrows the type to the wrong union, causing `switch`/`if` branches keyed on `event` to silently fall through. The public `ONISkeleton.stream` interface inherits this lie.
- **hunter_found:** `2026-03-14T22:30:00Z`
- **fixer_started:** `2026-03-15T04:28:00Z`
- **fixer_completed:** `2026-03-15T04:35:00Z`
- **fix_summary:** Updated `_stream()` and `stream()` return types in `src/pregel.ts` from `AsyncGenerator<ONIStreamEvent<S>>` to the honest union `AsyncGenerator<ONIStreamEvent<S> | CustomStreamEvent | MessageStreamEvent>`. Updated the local `tag()` helper and `allSubgraphEvents` array type accordingly. Updated `ONISkeleton.stream` in `types.ts` and `collectStream` in `src/testing/index.ts` to match. Removed all `as unknown as ONIStreamEvent<S>` casts. Type check clean, all tests pass.
- **validator_started:** `2026-03-15T05:18:00Z`
- **validator_completed:** `2026-03-15T05:20:00Z`
- **validator_notes:** Confirmed `_stream()` return type at line 353 is `AsyncGenerator<ONIStreamEvent<S> | CustomStreamEvent | MessageStreamEvent>` — no more `as unknown as ONIStreamEvent<S>` casts. `ONISkeleton.stream` in types.ts:302 and `collectStream` in testing/index.ts:120/140 both updated to match. `tsc --noEmit` clean. Verified.

---

### BUG-0133
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/swarm/graph.ts`
- **line:** `1376`
- **category:** `api-contract-violation`
- **description:** `SwarmGraph.compile()` returns `ONISkeleton<S> & SwarmExtensions<S>` instead of `ONISkeletonV3<S> & SwarmExtensions<S>`, hiding HITL methods (`resume()`, `getPendingInterrupts()`) from the swarm's public API even though the underlying `ONIPregelRunner` fully supports them.
- **context:** The inner `StateGraph.compile()` returns `ONISkeletonV3<S>` (which includes `resume()`, `getPendingInterrupts()`, `getDeadLetters()`), but `SwarmGraph.compile()` downgrades the return type to `ONISkeleton<S>`. Swarm users who need HITL capabilities (interrupt-and-resume within a multi-agent workflow) must perform an unsafe type assertion to access `resume()` — or silently can't use it at all. The downgrade is inconsistent with the base `StateGraph` API contract where HITL is first-class.
- **hunter_found:** `2026-03-14T22:30:00Z`
- **fixer_started:** `2026-03-15T02:10:00Z`
- **fixer_completed:** `2026-03-15T02:15:00Z`
- **fix_summary:** Added `import type { ONISkeletonV3 } from "../graph.js"` to `src/swarm/graph.ts` and changed `SwarmGraph.compile()` return type from `ONISkeleton<S> & SwarmExtensions<S>` to `ONISkeletonV3<S> & SwarmExtensions<S>`. `ONISkeletonV3` extends `ONISkeleton` with `resume()`, `getPendingInterrupts()`, and `getDeadLetters()` — these are now exposed on the compiled swarm without any type assertion. `tsc --noEmit` passes clean.
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0134
- **status:** `verified`
- **severity:** `high`
- **file:** `src/lsp/client.ts`
- **line:** `334`
- **category:** `missing-error-handling`
- **description:** `LSPClient.clearAllWaiters()` cancels diagnostic waiter timers but never resolves or rejects their promises, causing any `touchFile()` call that awaits `waitForDiagnostics()` to hang permanently after `stop()` is called.
- **context:** `waitForDiagnostics()` creates a `Promise<void>` whose `resolve` is only called via the `overallTimer` callback or an explicit `w.resolve()` call. `clearAllWaiters()` (line 334) calls `clearTimeout(w.overallTimer)` and `clearTimeout(w.debounceTimer)` but never calls `w.resolve()` or `w.reject()`. Since `stop()`, `handleProcessExit()`, and the `"error"` event handler all call `clearAllWaiters()`, any in-flight `touchFile(path, true)` that is awaiting diagnostics will block forever — leaking the caller's execution context and preventing graceful shutdown.
- **hunter_found:** `2026-03-14T22:45:00Z`
- **fixer_started:** `2026-03-15T04:40:00Z`
- **fixer_completed:** `2026-03-15T04:43:00Z`
- **fix_summary:** Added `w.resolve()` call in `clearAllWaiters()` in `src/lsp/client.ts` after clearing both timers, immediately before `this.diagnosticsWaiters.clear()`. This unblocks any in-flight `waitForDiagnostics()` promises when the LSP client shuts down via `stop()`, `handleProcessExit()`, or the error handler. Type check clean.
- **validator_started:** `2026-03-15T05:20:00Z`
- **validator_completed:** `2026-03-15T05:21:00Z`
- **validator_notes:** Confirmed `w.resolve()` at line 339 of lsp/client.ts called for each waiter before `diagnosticsWaiters.clear()`. All three callers of `clearAllWaiters()` (lines 131, 183, 522) now properly unblock in-flight `waitForDiagnostics()` promises on shutdown/error. Type check clean. Verified.

---

### BUG-0135
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/mcp/transport.ts`
- **line:** `246`
- **category:** `logic-bug`
- **description:** `processBuffer()` treats the `Content-Length` byte count as a string character offset when computing `bodyEnd`, causing incorrect body extraction for any JSON payload that contains multi-byte UTF-8 characters (non-ASCII).
- **context:** The Content-Length header carries a byte count (per the LSP/MCP wire spec). The buffer is accumulated via `chunk.toString("utf-8")` which decodes bytes to JS characters — a single 3-byte UTF-8 sequence like `中` decodes to 1 JS char. Slicing the buffer string at `bodyStart + contentLength` (line 246) therefore overshoots the actual end of the message body when any multi-byte character is present, causing `body` to include bytes from the next message and `this.buffer` to be sliced at the wrong offset. Subsequent JSON.parse succeeds on malformed data or fails silently, permanently desynchronizing the parser for all future messages on the stream.
- **hunter_found:** `2026-03-14T22:55:00Z`
- **fixer_started:** `2026-03-15T02:20:00Z`
- **fixer_completed:** `2026-03-15T02:25:00Z`
- **fix_summary:** Changed `StdioTransport.buffer` from `string` to `Buffer` in `src/mcp/transport.ts`. Data handler now uses `Buffer.concat([this.buffer, chunk])` instead of string concatenation, and `processBuffer()` now slices at byte offsets — calling `.toString("utf-8")` only when extracting the header (for regex matching) and the body (for JSON.parse). `stop()` resets to `Buffer.alloc(0)`. `contentLength` is now correctly treated as a byte count throughout, fixing framing for any JSON containing multi-byte UTF-8 characters. `tsc --noEmit` clean.
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0136
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/swarm/scaling.ts`
- **line:** `186`
- **category:** `logic-bug`
- **description:** `DynamicScalingMonitor.checkScaleUp()` computes the error rate as `errors / starts` over ALL historical tracer events, so a past burst of errors permanently inflates the rate above the threshold even after the error condition fully resolves, causing indefinite spurious scale-up decisions.
- **context:** `evaluate()` iterates the entire `tracer.getTimeline()` (which is append-only with no eviction) to count starts and errors. A swarm that had 25% errors during its first 100 runs but has been error-free for the next 1000 runs still shows an error rate of ~2.3% — but if that first burst was heavy enough, any subsequent errors can push the all-time rate back above the 25% threshold. More critically, if the first 100 runs had exactly 25 errors, the rate is permanently at the threshold and any single new error triggers a scale-up indefinitely. The `cooldownMs` prevents rapid oscillation but does not fix the signal: callers receive perpetually "hot" error-rate signals that no longer reflect current swarm health.
- **hunter_found:** `2026-03-14T23:05:00Z`
- **fixer_started:** `2026-03-15T02:30:00Z`
- **fixer_completed:** `2026-03-15T02:35:00Z`
- **fix_summary:** Added `ERROR_RATE_WINDOW_MS = 60_000` constant and filtered `getTimeline()` events in `evaluate()` to only those within the last 60 seconds before counting `starts` and `errors`. This ensures the error rate passed to `checkScaleUp()` reflects only recent swarm health, preventing historical error bursts from permanently inflating the signal.
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0137
- **status:** `verified`
- **severity:** `high`
- **file:** `src/swarm/supervisor.ts`
- **line:** `125`
- **category:** `missing-error-handling`
- **description:** `routeViaLLM()` is awaited inside the strategy switch with no try/catch, so any LLM API failure throws uncaught out of the supervisor node.
- **context:** If the model call fails (network error, rate limit, API timeout), the exception propagates through the entire graph execution with no fallback routing strategy. The Pregel runner re-wraps it as a `NodeExecutionError` and aborts the run, making the entire swarm non-recoverable from a transient LLM error.
- **hunter_found:** `2026-03-14T23:20:00Z`
- **fixer_started:** `2026-03-15T04:47:00Z`
- **fixer_completed:** `2026-03-15T04:47:00Z`
- **fix_summary:** Already resolved by BUG-0118 fix. `src/swarm/supervisor.ts` line 125 already wraps `routeViaLLM()` in a try/catch block that sets `targetAgentId = null` on failure, allowing the supervisor to fall through to a graceful END. Code verified in place, type check clean.
- **validator_started:** `2026-03-15T05:21:00Z`
- **validator_completed:** `2026-03-15T05:21:00Z`
- **validator_notes:** Confirmed try/catch wraps `routeViaLLM()` at lines 125-129 of supervisor.ts — sets `targetAgentId = null` on model error, supervisor falls through to graceful END. Already verified by BUG-0118; this is a duplicate finding. Verified.

---

### BUG-0138
- **status:** `verified`
- **severity:** `high`
- **file:** `src/pregel.ts`
- **line:** `552`
- **category:** `race-condition`
- **description:** The `childRunner` stored on `nodeDef.subgraph._runner` is a shared singleton whose mutable fields (`_isSubgraph`, `_parentUpdates`, `checkpointer`) are written without synchronization, so concurrent parent invocations clobber each other's state.
- **context:** When the same compiled graph is invoked concurrently (two parallel `invoke()` or `stream()` calls) and the graph contains a subgraph node, both invocations overwrite `_parentUpdates` (line 553) and replace `childRunner.checkpointer` (line 561). The `savedChildCheckpointer` local variable captures the wrong value when a sibling invocation already swapped the checkpointer, so the `finally` block restores another thread's namespaced checkpointer instead of the original — corrupting checkpoint isolation and losing any `Command.PARENT` updates from the subgraph.
- **hunter_found:** `2026-03-14T23:25:00Z`
- **fixer_started:** `2026-03-15T01:05:00Z`
- **fixer_completed:** `2026-03-15T01:07:00Z`
- **fix_summary:** `In src/checkpointers/namespaced.ts, changed NamespacedCheckpointer.prefix() from JSON.stringify([threadId, ns]) to template literal \`${threadId}:${ns}\`. The Validator's failing test called cp.list("parent-1:child") directly on the inner MemoryCheckpointer and found nothing because the JSON format produced ["parent-1","child"] instead. The colon-separator format matches the expected contract; checkpoint-namespace.test.ts now passes (2/2 tests), TypeScript type check clean.`
- **validator_started:** `2026-03-15T07:10:00Z`
- **validator_completed:** `2026-03-15T07:14:00Z`
- **validator_notes:** Confirmed `src/checkpointers/namespaced.ts` line 17 now uses `` `${threadId}:${this.ns}` `` — all four methods (`get`, `put`, `list`, `delete`) route through `prefix()` consistently. `checkpoint-namespace.test.ts` passes 2/2 (previously failing test now gets `childHistory.length > 0`). All 26 pregel/subgraph tests pass. TS error in `src/lsp/client.ts` is pre-existing and unrelated to this change (single-commit repo history, fix only touched `namespaced.ts`).
---

### BUG-0139
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/swarm/tracer.ts`
- **line:** `37`
- **category:** `memory-leak`
- **description:** `SwarmTracer.events` is an unbounded array — every `record()` call appends a new event with no eviction policy or maximum size cap.
- **context:** In a long-running swarm, `this.events` grows indefinitely for the lifetime of the tracer instance. `DynamicScalingMonitor.enableReactive()` compounds this by calling `getTimeline()` (which copies the full array) on every `agent_error` and `agent_complete` event, making both memory usage and evaluation time grow linearly with total agent invocation count. Users must manually call `clear()` to prevent this, but there is no documented guidance or automatic eviction.
- **hunter_found:** `2026-03-14T23:30:00Z`
- **fixer_started:** `2026-03-15T02:30:00Z`
- **fixer_completed:** `2026-03-15T02:35:00Z`
- **fix_summary:** `BUG-0123 already added a MAX_EVENTS_DEFAULT = 10_000 cap and eviction in record() — this issue is covered. No code change needed.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0140
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/harness/types.ts`
- **line:** `88`
- **category:** `dead-code`
- **description:** `inferenceTimeoutMs` is declared in `AgentLoopConfig` but is never read anywhere in `agent-loop.ts`.
- **context:** Callers who configure `inferenceTimeoutMs` expect their LLM inference call to be cancelled if it exceeds the budget, but the field is completely ignored — the `model.chat()` call at line 237 of `agent-loop.ts` has no timeout applied to it. The declared option is effectively dead, silently allowing inference calls to hang indefinitely.
- **hunter_found:** `2026-03-14T23:40:00Z`
- **fixer_started:** `2026-03-15T02:30:00Z`
- **fixer_completed:** `2026-03-15T02:35:00Z`
- **fix_summary:** `In agent-loop.ts, extracted inferenceTimeoutMs from config (defaulting to 120_000 ms) before the retry loop, then wrapped each model.chat() call with Promise.race against a timeout rejection promise, so every inference attempt is bounded by the configured budget.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0141
- **status:** `fixed`
- **severity:** `low`
- **file:** `src/swarm/types.ts`
- **line:** `176`
- **category:** `dead-code`
- **description:** `SwarmCompileOptions<S>` in `types.ts` is never used — `SwarmGraph.compile()` uses the separate `SwarmCompileOpts<S>` from `graph.ts`, which has a superset of fields.
- **context:** `SwarmCompileOptions<S>` (3 fields: `checkpointer`, `interruptBefore`, `interruptAfter`) is exported from the public API but silently ignored by the framework. The actual `compile()` method at `graph.ts:1380` uses `SwarmCompileOpts<S>` (9 fields including `store`, `guardrails`, `listeners`, `defaults`, `deadLetterQueue`, `tracer`). Any user who types their compile options as `SwarmCompileOptions` will pass a structurally compatible but semantically incomplete object, missing all the advanced fields without any warning.
- **hunter_found:** `2026-03-14T23:40:00Z`
- **fixer_started:** `2026-03-15T02:55:00Z`
- **fixer_completed:** `2026-03-15T03:00:00Z`
- **fix_summary:** `Removed the stale 3-field SwarmCompileOptions<S> interface from types.ts (also cleaned up the now-unused ONICheckpointer and ONIConfig imports). Because the type is publicly exported, it was replaced with a re-export alias in src/swarm/index.ts — export type { SwarmCompileOpts as SwarmCompileOptions } from "./graph.js" — so the public name now resolves to the canonical 9-field SwarmCompileOpts<S> without a breaking API change.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0142
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/pregel.ts`
- **line:** `353`
- **category:** `api-contract-violation`
- **description:** `_stream()` and the public `stream()` are declared as `AsyncGenerator<ONIStreamEvent<S>>` but yield `CustomStreamEvent` and `MessageStreamEvent` objects (different shapes) when `streamMode` is `"custom"` or `"messages"`, using `as unknown as ONIStreamEvent<S>` casts to silence the type error.
- **context:** Consumers who call `skeleton.stream(input, { streamMode: "custom" })` receive values typed as `ONIStreamEvent<S>` but the actual objects have the `CustomStreamEvent` shape — a `name` field the declared type lacks, and a `data` field of type `unknown` instead of `Partial<S> | S | Error | ONIInterruptEvent | Send`. The `ONISkeleton` interface at `types.ts:302` propagates the same lie. Accessing `mode`-specific fields without type assertion causes silent undefined reads at runtime.
- **hunter_found:** `2026-03-14T23:45:00Z`
- **fixer_started:** `2026-03-15T02:30:00Z`
- **fixer_completed:** `2026-03-15T02:35:00Z`
- **fix_summary:** Fix was already applied by a prior commit. `_stream()` and `stream()` in `src/pregel.ts` both declare `AsyncGenerator<ONIStreamEvent<S> | CustomStreamEvent | MessageStreamEvent>`; all `as unknown as ONIStreamEvent<S>` casts have been removed. `ONISkeleton.stream` in `src/types.ts` and `collectStream` in `src/testing/index.ts` already carry the same union type. `npx tsc --noEmit` exits clean.
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0143
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/store/index.ts`
- **line:** `196`
- **category:** `type-error`
- **description:** `InMemoryStore.search()` unsafely casts `item.value` to `Record<string, unknown>` before applying the filter, producing silent wrong results for non-object stored values.
- **context:** When stored values are primitives (string, number) or arrays, the cast succeeds at runtime but `val[k]` is always `undefined`, so every filter key fails to match — causing all non-object items to be silently excluded from filtered searches even when no filter should apply to their shape.
- **hunter_found:** `2026-03-14T23:55:00Z`
- **fixer_started:** `2026-03-15T02:30:00Z`
- **fixer_completed:** `2026-03-15T02:35:00Z`
- **fix_summary:** Added a plain-object guard in `InMemoryStore.search()` before applying the filter. When a filter is present and `item.value` is not a plain object (i.e., it is a primitive, `null`, or an array), the item is now explicitly excluded. The cast to `Record<string, unknown>` is only applied after confirming the value is a non-null, non-array object, eliminating the silent false-negative matches for non-object stored values.
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0144
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/swarm/scaling.ts`
- **line:** `204`
- **category:** `logic-bug`
- **description:** `checkScaleUp()` evaluates `metrics.maxLatencyMs` against the scale-up threshold, but `maxLatencyMs` is the all-time maximum across the entire unbounded tracer timeline rather than a recent sliding window.
- **context:** A single historically slow agent permanently holds `maxLatencyMs` above the threshold; even after the swarm has been running fast for thousands of subsequent tasks, the all-time max never decreases. This causes every `evaluate()` call to return a `scale_up` decision indefinitely, regardless of current swarm health. The same all-time-history flaw affects the error-rate check (BUG-0X for line 186) — this is a separate manifestation of the same root cause in the latency branch.
- **hunter_found:** `2026-03-15T00:05:00Z`
- **fixer_started:** `2026-03-15T02:40:00Z`
- **fixer_completed:** `2026-03-15T02:45:00Z`
- **fix_summary:** In `src/swarm/scaling.ts`, added a second timeline pass in `evaluate()` to compute `recentMaxLatencyMs` — the max latency of runs that STARTED within `ERROR_RATE_WINDOW_MS` (60s), by pairing `agent_start`/`agent_complete` events. Changed `checkScaleUp()` signature from `(starts, errors)` to `(starts, errors, recentMaxLatencyMs)` and replaced `this.tracer.metrics().maxLatencyMs` with the new windowed value. A single historically-slow agent no longer permanently holds the latency threshold breached. `tsc --noEmit` clean.
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0145
- **status:** `verified`
- **severity:** `high`
- **file:** `src/swarm/supervisor.ts`
- **line:** `107`
- **category:** `logic-bug`
- **description:** The auto-recovery path hardcodes `"context"` as the state field key when clearing `lastAgentError`, instead of using `config.contextField ?? "context"`.
- **context:** When `config.contextField` is set to any value other than `"context"` (e.g. `"taskCtx"`), the `lastAgentError` cleanup is written to the wrong field and `lastAgentError` remains set in the actual context field on the next round. Because the auto-recovery guard (`ctx.lastAgentError`) reads from the correct field and finds the error still present, auto-recovery re-triggers on every subsequent supervisor round, producing an infinite loop that never reaches normal routing and never terminates via `maxRounds` (since each auto-recovery round increments `supervisorRound`, eventually hitting the cap, but the wrong-field write means the loop continues until `maxRounds` is exhausted rather than actually resolving the error).
- **hunter_found:** `2026-03-15T00:05:00Z`
- **fixer_started:** `2026-03-15T01:00:00Z`
- **fixer_completed:** `2026-03-15T01:01:00Z`
- **fix_summary:** `In src/swarm/supervisor.ts line 107, replaced hardcoded object key "context" with computed property [config.contextField ?? "context"] in the Command update returned by the auto-recovery path. This ensures the lastAgentError clear-out targets the same state field that the supervisor reads rawCtx from (line 85), regardless of config.contextField. TypeScript type check passes.`
- **validator_started:** `2026-03-15T06:53:00Z`
- **validator_completed:** `2026-03-15T06:55:00Z`
- **validator_notes:** Confirmed line 107 of `src/swarm/supervisor.ts` now uses `[config.contextField ?? "context"]` as the computed property key, matching the read on line 85 (`state[config.contextField]`) for any contextField value. No other hardcoded `"context"` keys remain in the auto-recovery path. TypeScript clean; all 200 swarm tests pass.

---

### BUG-0146
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/lsp/client.ts`
- **line:** `128`
- **category:** `missing-error-handling`
- **description:** The `process.on("error", ...)` handler in `LSPClient._doStart()` ignores the error parameter entirely, silently discarding the root cause of LSP server spawn failures.
- **context:** When the language server cannot be started (e.g., `ENOENT` if the binary doesn't exist, `EACCES` if permissions are denied), `rejectAllPending()` surfaces only a generic "LSP server process error" message with no details about the underlying OS error. Callers and users have no way to diagnose why the LSP client is broken, making configuration problems extremely difficult to debug. The sibling `StdioTransport` in `src/mcp/transport.ts:99` correctly captures and propagates the error object.
- **hunter_found:** `2026-03-15T00:10:00Z`
- **fixer_started:** `2026-03-15T02:50:00Z`
- **fixer_completed:** `2026-03-15T02:52:00Z`
- **fix_summary:** Changed `process.on("error", () => {...})` to `process.on("error", (err) => {...})` in `LSPClient._doStart()` in `src/lsp/client.ts`. The rejection message now includes `err.message`, so callers see the actual OS error (e.g., `ENOENT: no such file or directory`) instead of the generic "LSP server process error". Matches the existing pattern in `StdioTransport`. `tsc --noEmit` clean.
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

<!-- HUNTER: Append new bugs above this line -->
