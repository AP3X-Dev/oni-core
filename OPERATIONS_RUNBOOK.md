# ONI Core Operations Runbook

This runbook covers the production-facing background-agent control plane in this
package: platform sessions, external-agent runners, native loop/swarm runners,
artifacts, policy enforcement, and audit review.

## Required Evidence

Collect these records before changing policy, re-running a task, or escalating a
failure:

- Session record: session id, task id, status, lifecycle timestamps, workspace
  path, identity id, and runner metadata.
- Task spec: goal, scope, constraints, success criteria, review requirements,
  allowed actions, and required capabilities.
- Artifacts: report, patch, review comment, failed-run diagnosis, test summary,
  or migration report.
- Audit events: capability grants, policy denials, approvals, output artifacts,
  command/network/path decisions, and runner lifecycle events.
- Runner logs: external-agent provider frames, retained stdout/stderr summaries,
  timeout/abort events, and sanitized resume metadata.
- Capacity context: queue depth, concurrency limit, timeout budget, model budget,
  workspace size, and idle shutdown status.

Do not copy secret values into incident notes. Capability audit events summarize
secret grants by name/type/scope/metadata keys only.

## Stuck Session

Use this flow when a session remains queued, running, canceling, or hibernating
longer than its expected timeout.

1. Confirm the session status and last audit event.
2. Check whether the fleet orchestrator still owns the lease for the session.
3. Inspect capacity controls: queue priority, concurrency caps, timeout budget,
   environment size, and idle shutdown state.
4. Inspect the execution environment: workspace path, branch, process tree,
   active terminal command, and last retained provider event.
5. If the session is running an external CLI provider, confirm the provider
   process tree was terminated after timeout or abort. Windows runs should use
   process-tree cleanup rather than only killing the parent process.
6. If the task is resumable, preserve workspace state and record resume metadata:
   provider session id, command, cwd, and metadata keys.
7. If the task is not resumable, cancel the session, emit a failed-run diagnosis
   artifact, and require a fresh task spec before retry.

Recovery rules:

- Retry only after the stuck cause is understood or the retry changes capacity,
  policy, environment, or provider conditions.
- Do not merge or publish artifacts from a session with missing audit records.
- Do not grant broader credentials to unstick a run without an explicit review
  gate and a new capability grant.

## Failed Provider Run

Use this flow when Codex, Claude Code, or another external-agent driver exits
non-zero, times out, aborts, or emits malformed output.

1. Open the failed-run diagnosis artifact first. It is the durable summary meant
   for review and handoff.
2. Check the outcome status, exit code, signal, timeout flag, duration, retained
   stdout/stderr lengths, dropped event count, and truncated content count.
3. Review provider-neutral events before raw text: text deltas, tool calls,
   diffs, artifacts, encrypted reasoning markers, and malformed-frame artifacts.
4. Confirm provider resume metadata is sanitized. Store only provider session id,
   platform session id, command, cwd, and provider metadata keys.
5. If the provider requested a denied path, command, network target, or secret,
   resolve the policy mismatch before retrying.
6. If output caps were hit, reproduce with a narrower task spec or increase caps
   only for the specific runner configuration.
7. If JSONL parsing failed, keep the malformed frame artifact and add a parser
   fixture before broadening accepted provider formats.

Retry rules:

- Reuse the same task spec when validating a provider flake.
- Create a new task spec when changing goal, scope, permissions, or success
  criteria.
- Preserve failed artifacts. They are part of the audit trail and are often the
  only evidence available after provider cleanup.

## Audit Review

Use this flow before approving, merging, publishing, or replaying agent output.

1. Confirm the session has a task spec, trigger, identity, environment,
   capability grants, runner outcome, artifacts, and final audit event.
2. Compare requested capabilities to granted capabilities. Extra grants require
   a written explanation in the review record.
3. Inspect denied events. A denied event is not automatically a failure, but it
   must be explained if the output is accepted.
4. Confirm policy was enforced below the prompt layer for platform-run tools or
   external agents.
5. Confirm artifacts are reviewable: PR, patch, report, triage note, test
   summary, release note, or failed-run diagnosis.
6. Confirm retained provider output was capped and that dropped/truncated counts
   are visible when caps were exceeded.
7. Confirm secret values are absent from artifacts, audit events, provider
   metadata, and incident notes.

Approval rules:

- Human review remains accountable for merge, deploy, publish, and credential
  escalation decisions.
- A green provider exit is not enough. The review must validate scope,
  permissions used, tests run, and artifact content.
- Missing audit data is a production blocker unless the task is explicitly
  classified as disposable local experimentation.

## Release Gate

Before release or broad rollout, run:

```powershell
pnpm run verify:release
git diff --check
```

`verify:release` must include normal verification, strict typechecking, root
build, runtime export smoke, type-level export smoke, workspace package builds,
dependency audit, root pack dry-run, and publishable workspace pack dry-runs.
