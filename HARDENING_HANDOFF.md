# Hardening Handoff

Date: 2026-05-23
Workspace: `C:\Users\Guerr\Desktop\oni-core-cerebro`

## Active Objective

Continue production hardening until `PRODUCTION_HARDENING_PLAN.md` is genuinely complete or a real blocker is reached. The user wants execution, not a fresh analysis loop.

## Clean Stopping Point

Stop here. The HTTP/Cerebro environment provider slice is complete, exported, tested, documented, and covered by the full release gate. A follow-up external-agent env-isolation slice is also complete with focused tests and strict typecheck green. There is no known partially implemented file in either slice.

Latest verified baseline:

- `pnpm run verify:release`: PASS.
- Root tests inside release gate: 306 files, 1705 passed, 2 skipped.
- `coverage:quality`: statements 81.39%, branches 71.70%, functions 83.82%, lines 83.04%.
- Platform suite: 7 files, 47 tests.
- Root tarball snapshot: 677 files, 522.7 KB packed, 336 source maps.
- `npm pack --dry-run`: 677 files, about 535.3 KB packed / 2.4 MB unpacked.
- `pnpm audit --prod --audit-level moderate`: no known vulnerabilities.
- `git diff --check`: PASS after this handoff update, with CRLF normalization warnings only.

Latest focused verification after the env-isolation slice:

- `pnpm exec vitest run src/harness/__tests__/ExternalAgent.test.ts src/platform/__tests__/production.test.ts`: PASS, 2 files, 34 tests.
- `pnpm exec vitest run src/platform src/harness/__tests__/ExternalAgent.test.ts`: PASS, 8 files, 70 tests.
- `pnpm run typecheck:strict`: PASS.
- `git diff --check`: PASS with CRLF normalization warnings only.
- Full `verify:release` has not been rerun after this follow-up slice; run it early in the next session if you need a release-grade checkpoint before more changes.

## Completed Hardening Slices

- Release gate made honest: strict typecheck, package builds, audit, export smokes, pack dry runs, tarball snapshot checks, and coverage quality are in `verify:release`.
- Durable platform state:
  - JSON-file session/artifact stores.
  - SQLite session/artifact stores in `src/platform/sqlite-store.ts`.
  - Postgres session/artifact stores in `src/platform/postgres-store.ts`.
- Platform publication and ingestion:
  - `GitHubArtifactStore` for PR/comment publication.
  - CLI, scheduled, GitHub webhook, chat command, and dependency alert trigger adapters.
- Platform policy and execution:
  - Runtime policy helpers and reusable tool wrappers.
  - External-agent, harness `agentLoop`, and swarm session runners.
  - Local execution environment provider and `oni platform-smoke`.
- Remote environment provider:
  - `src/platform/http-environment.ts` defines `HttpExecutionEnvironmentProvider` and `CerebroExecutionEnvironmentProvider`.
  - Providers validate base URLs and endpoint paths, send compact authenticated provision payloads, map nested/snake_case responses, sanitize HTTP failures, and support release/health calls.
  - Exported from `src/platform/index.ts` and root `src/index.ts`.
  - Covered by `src/platform/__tests__/http-environment.test.ts`.
- External-agent env isolation:
  - `ExternalAgentRunRequest` and `CliExternalAgentDriverConfig` now support `inheritProcessEnv` and `redactValues`.
  - CLI external-agent drivers use a minimal safe OS env baseline when broad inheritance is disabled.
  - CLI external-agent stdout/stderr/text events redact configured values before events are stored or emitted.
  - `ExternalAgentSessionRunner` disables broad inherited env by default for platform-run CLI agents and passes granted secret values as redaction inputs.
  - Covered by `src/harness/__tests__/ExternalAgent.test.ts` and `src/platform/__tests__/production.test.ts`.
- Release docs updated:
  - `PRODUCTION_HARDENING_PLAN.md`
  - `PROJECT_CONTEXT.md`
  - `README.md`
  - `CHANGELOG.md`
  - `PACKAGE_RELEASE_POLICY.md`
  - `OPERATIONS_RUNBOOK.md`

## Verification To Trust

These checks passed after the HTTP/Cerebro provider was added:

```powershell
pnpm exec vitest run src/platform/__tests__/http-environment.test.ts src/platform/__tests__/production.test.ts
pnpm exec vitest run src/platform
pnpm run typecheck:strict
pnpm run build
pnpm run coverage:quality
pnpm run smoke:exports
pnpm run typecheck:exports
node scripts/check-package-tarballs.mjs
pnpm run verify:release
```

The full release gate produced only known npm config warnings for unknown env configs (`verify-deps-before-run`, `_jsr-registry`).

These checks passed after the external-agent env-isolation slice:

```powershell
pnpm exec vitest run src/harness/__tests__/ExternalAgent.test.ts src/platform/__tests__/production.test.ts
pnpm exec vitest run src/platform src/harness/__tests__/ExternalAgent.test.ts
pnpm run typecheck:strict
git diff --check
```

## Next Session Start

Start by reading:

```powershell
Get-Content PRODUCTION_HARDENING_PLAN.md
Get-Content PROJECT_CONTEXT.md
Get-Content HARDENING_HANDOFF.md
git status --short
```

Then continue from `PRODUCTION_HARDENING_PLAN.md` under `Immediate Next Slice`.

## Recommended Next Slice

The next bounded hardening pass should focus on runtime policy integration outside the already-governed platform runner:

1. Wire policy wrappers into checkpoint, skill, artifact, and shell-capable surfaces where platform context is available.
2. Add direct tests proving denied paths and denied commands are blocked in those surfaces; platform-run CLI env inheritance now has focused coverage.
3. Keep audit events sanitized when denials happen.
4. Run:

```powershell
pnpm exec vitest run src/platform src/harness packages/tools
pnpm run verify:release
pnpm run test:coverage
git diff --check
```

Secondary queues after that:

- Raise remaining low coverage pockets: LSP client, CLI command paths, GitHub tools, auth resolver, functional API, and namespaced checkpointer.
- Reduce lint/console-noise debt so production warnings stay actionable.
- Replace the regex/basic secret scan with a dedicated scanner before release.

## Dirty Tree Warning

The tree is intentionally dirty from the hardening passes. Do not revert unrelated files. `src/platform/` is untracked as a directory in this worktree, but it contains the platform implementation and tests created during these passes.

Before continuing, run:

```powershell
git status --short
```

Treat existing changes as user/agent work to preserve unless they directly block the next slice.
