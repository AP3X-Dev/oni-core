# Production Hardening Plan

Date: 2026-05-23

This plan is based on a local audit of the current `@oni.bot/core` workspace.
The system is a capable TypeScript agent runtime with strong test coverage and
several security-focused modules. As of 2026-06-04 every priority below is
complete: the release gate is honest and green (now including content secret
scanning and a blocking lint-warning budget), dependency advisories are patched,
strict typing holds, durable platform providers and runners exist, runtime
policy is enforced below the prompt layer across tool/filesystem/code-execution/
skill surfaces with shared secret redaction, an injectable logger and versioned
event taxonomy provide operational evidence, and the public API is locked with
subpath import/type tests. See **Status: Complete** at the end for the final
summary. Original audit findings are preserved below for historical context.

## Current Evidence

Commands run during this audit:

| Check | Result | Notes |
| --- | --- | --- |
| `pnpm run verify` | PASS | Root: 306 test files, 1705 passed, 2 skipped. Package typechecks/tests passed. |
| `pnpm --filter "./packages/**" run build` | PASS | Workspace package builds now include the private `packages/community` stub. |
| `pnpm run test:coverage` | PASS | Global coverage: statements 81.39%, branches 71.70%, functions 83.82%, lines 83.04%. |
| `pnpm run coverage:quality` | PASS | Blocking global and module-specific coverage thresholds pass: statements 81.39%, branches 71.70%, functions 83.82%, lines 83.04%. |
| `pnpm run typecheck:strict` | PASS | Strict typecheck is now part of the root release gate. |
| `pnpm audit --prod --audit-level moderate` | PASS | `brace-expansion` and `ws` transitives are pinned to patched versions through pnpm overrides. |
| `pnpm run verify:release` | PASS | Runs normal verify, blocking coverage quality thresholds, strict typecheck, root build, subpath runtime/type export smoke, package builds, prod audit, root/package pack dry runs, and tarball snapshot checks. Latest root test count: 306 files, 1705 passed, 2 skipped. |
| `pnpm exec vitest run src/platform src/__tests__/cli-platform-smoke.test.ts src/__tests__/cli-router.test.ts` | PASS | 4 files, 23 tests. Covers durable platform state, trigger adapters, policy-wrapped tools, and local platform smoke. |
| `pnpm exec vitest run src/harness/__tests__/ExternalAgent.test.ts` | PASS | 1 file, 22 tests. Covers external-agent host/registry, CLI adapters, provider-style JSONL parsing, malformed frames, unsafe option denial, output caps, timeout termination, provider path scope denial, no-inherited-env mode, and stdout/stderr event redaction. |
| `pnpm exec vitest run src/platform src/harness/__tests__/ExternalAgent.test.ts` | PASS | 8 files, 70 tests. Covers platform control-plane plus external-agent env isolation/redaction after the follow-up hardening slice. |
| `pnpm exec vitest run src/platform` | PASS | 7 files, 47 tests. Covers platform stores, SQLite/Postgres durable state, HTTP/Cerebro environment provisioning, GitHub artifact publication, trigger ingestion, runtime policy, tool wrappers, external-agent runner, agentLoop runner, swarm runner, denial audit, capability summaries, failed external-agent diagnostics, health/audit summaries, and lifecycle logs/spans. |
| `node dist/cli/index.js platform-smoke --dir <temp> --json` | PASS | Built CLI path completed a local platform session and wrote one durable artifact. |
| `node --input-type=module -e "<platform import smoke>"` | PASS | Built root and `./platform` exports expose trigger and tool-policy helpers. |
| `pnpm exec vitest run src/platform src/harness/__tests__/ExternalAgent.test.ts src/__tests__/cli-platform-smoke.test.ts src/__tests__/cli-router.test.ts` | PASS | 5 files, 49 tests. Focused platform/external-agent/CLI smoke suite. |
| `pnpm run build && pnpm run smoke:exports` | PASS | Imports 23 built root export subpaths and verifies generated type targets. |
| `pnpm run build && pnpm run typecheck:exports` | PASS | Compiles package-name type imports for all 23 root export subpaths against built declarations. |
| `pnpm --filter "@oni.bot/tools" run typecheck && pnpm --filter "@oni.bot/tools" run test` | PASS | 13 files, 75 tests. Covers filesystem `runtimePolicy` integration and existing package tool hardening. |
| `pnpm exec vitest run src/platform && pnpm run typecheck:strict` | PASS | Covers platform health/audit summaries, lifecycle logger/span hooks, and verifies strict public types. |
| `pnpm exec vitest run src/__tests__/messages.test.ts src/__tests__/prebuilt-tool-node.test.ts src/__tests__/tool-framework.test.ts src/__tests__/lsp.test.ts src/__tests__/inspect.test.ts` | PASS | 5 files, 21 tests. Raises coverage for messages, prebuilt tool-node, core tools, LSP helpers, and graph inspection. |
| `pnpm exec vitest run src/__tests__/circuit-breaker-integration.test.ts src/__tests__/mcp-stdio-transport.test.ts src/__tests__/prebuilt-react-agent.test.ts` | PASS | 3 files, 8 tests. Makes circuit-breaker reset timing deterministic and covers real MCP stdio plus ReAct ONIModel adapter paths. |
| `pnpm exec vitest run src/platform/__tests__/github-artifacts.test.ts src/platform/__tests__/platform.test.ts src/platform/__tests__/production.test.ts` | PASS | 3 files, 22 tests. Covers GitHub artifact publication, enriched artifact URIs, local mirroring, publish-disabled mode, and sanitized API failures. |
| `pnpm exec vitest run src/platform/__tests__/triggers.test.ts src/platform/__tests__/production.test.ts` | PASS | 2 files, 16 tests. Covers GitHub webhook signature verification plus GitHub, chat, and dependency trigger normalization. |
| `pnpm exec vitest run src/platform/__tests__/sqlite-store.test.ts src/platform/__tests__/production.test.ts` | PASS | 2 files, 17 tests. Covers SQLite session/artifact store persistence, status filtering, artifact upserts, corrupt JSON diagnostics, optional peer wiring, shared store wiring, and unsafe table-prefix rejection without requiring native optional peer bindings in the release test environment. |
| `pnpm exec vitest run src/platform/__tests__/postgres-store.test.ts src/platform/__tests__/production.test.ts` | PASS | 2 files, 17 tests. Covers Postgres session/artifact store persistence, status filtering, artifact upserts, corrupt JSON diagnostics, optional peer wiring, shared store wiring, and unsafe table-prefix rejection without requiring a live database. |
| `pnpm exec vitest run src/platform/__tests__/http-environment.test.ts src/platform/__tests__/production.test.ts` | PASS | 2 files, 19 tests. Covers HTTP/Cerebro devbox provisioning, compact authenticated request payloads, response mapping, release and health calls, sanitized HTTP failures, unsafe URL/path rejection, and full platform session wiring. |
| `pnpm exec vitest run src/harness/__tests__/ExternalAgent.test.ts src/platform/__tests__/production.test.ts` | PASS | 2 files, 34 tests. Covers CLI external-agent env isolation/redaction and platform-run CLI agents not inheriting ungranted process env values. |
| `pnpm exec vitest run src/__tests__/retry.test.ts` | PASS | 1 file, 9 tests. Retry backoff/max-delay tests now use fake timers and `maxDelay` caps the initial delay. |
| `pnpm run build && pnpm run smoke:exports && pnpm run typecheck:exports` | PASS | Public platform export now includes SQLite/Postgres platform stores, HTTP/Cerebro environment providers, `GitHubArtifactStore`, trigger ingestion helpers, and their option/metadata types. |
| `pnpm run build && pnpm run build:packages && pnpm run pack:snapshot` | PASS | Checks root plus 7 publishable workspace tarballs; root snapshot reports 677 files, 522.7 KB packed, and 336 source maps without embedded source content. |
| `npm pack --dry-run` | PASS | Root package packs successfully; 677 files, about 535.3 KB packed / 2.4 MB unpacked. |
| Secret file scan | PASS | No tracked `.env`, `.pem`, `.key`, `credentials.json`, or service-account files found. |

Important repo-shape observations:

- Normal verification and the stricter local release gate are green.
- The root package has zero runtime dependencies, but workspace packages have production dependencies.
- `packages/community` is a private stub and now participates in build/type/test package gates.
- `.gitignore` ignores `docs/`, while a local `docs/` tree exists. Any new hardening plan under `docs/` would be invisible to git unless forced.
- Lint exits with 0 errors, but still reports 434 warnings, mostly in tests.
- Package tests emit a Vitest warning for a nested `vi.mock("stripe")` in `packages/tools/src/__tests__/stripe.test.ts`; Vitest says this will become an error in a future version.

## Production-Ready Definition

Treat the repo as production-ready only when all of these are true:

- `verify:release` passes on a clean tree on Node 18, 20, and 22.
- Strict typecheck passes and is part of the local release gate.
- `pnpm audit --prod --audit-level moderate` passes or every remaining advisory has a documented exception.
- Every workspace package is either intentionally private/excluded or has build, typecheck, test, and pack gates.
- The platform can run at least one background coding task end to end: trigger -> session -> environment -> identity/capability grants -> runner -> artifact -> review gate -> audit record.
- Policy is enforced by code below the prompt layer for platform-run external agents, not only by instructions in prompts.
- Durable JSON-file session/artifact/audit state exists for local/single-node background-agent sessions.
- Public subpath exports have import/type smoke tests.
- Lint warnings are either eliminated or explicitly budgeted and tracked.
- Coverage gates include risk-based floors for security-critical modules, not only global averages.

## Audit Summary

### Secrets and Credentials

- PASS: No tracked secret files were found for `.env`, `.pem`, `.key`, `credentials.json`, or service-account names.
- PASS: `.gitignore` covers environment files, private keys, build artifacts, coverage, session logs, and AI config folders.
- PASS: A content secret scanner (`scripts/scan-secrets.mjs`, wired into `verify:release` as `audit:secrets`) scans every git-tracked source file for high-confidence credential shapes (private keys, provider tokens) while ignoring benign `apiKey`/`token` identifiers. It currently reports no findings.

### Dependencies

- PASS: `brace-expansion >=5.0.0 <5.0.6` is overridden to `5.0.6`.
- PASS: `ws >=8.0.0 <8.20.1` is overridden to `8.20.1`.
- WARN: Several package dev dependencies are behind current patch releases (`vite`, `vitest`, `@vitest/coverage-v8`, `tsx`, `typescript-eslint`).
- PASS: Workspace package peer ranges now target the current `@oni.bot/core` `^1.3.0` line.

### Code Hygiene

- PASS: No production `TODO`/`FIXME` backlog was found in source; TODO hits are mostly harness feature text and tests.
- PASS: Lint warnings are now budgeted and tracked. `scripts/lint-budget.mjs` (wired into `verify:release` as `lint:budget`) tallies warnings per rule against documented ceilings and fails on any lint error or budget regression, so the debt can only shrink. Current: 433 warnings (overwhelmingly `no-explicit-any` in test files), 0 errors.
- WARN: Several production modules log directly to console. CLI output is expected; library/server modules should prefer injectable logging or structured events.

### Release and CI

- PASS: Root and package test/typecheck gates pass under the current normal `verify` script.
- PASS: Strict typecheck passes locally and is included in `verify:release`.
- PASS: `verify:release` includes normal verify, blocking coverage quality thresholds, strict typecheck, root build, subpath runtime/type export smoke, package builds, dependency audit, root/package pack smoke, and tarball snapshot checks.
- WARN: CI smoke-tests only the root `dist/index.js` graph path, not every exported subpath.

### Platform Readiness

- PASS: `@oni.bot/core/platform` now models sessions, task specs, triggers, routing, environments, identity, capability grants, artifacts, review gates, audit events, and capacity controls.
- PASS: Durable JSON-file `AgentSessionStore` and `ArtifactStore` implementations exist for local/single-node deployments.
- PASS: A local workspace `ExecutionEnvironmentProvider` exists for session-scoped filesystem environments.
- PASS: Platform sessions can run through harness `ExternalAgentDriver` instances via `ExternalAgentSessionRunner`.
- PASS: Platform-run external agents get runtime policy checks for path-scope validity, explicit env secret grants, declared required commands/network, denial audit, and artifact/output secret redaction.
- PASS: Codex/Claude convenience drivers now deny raw `extraArgs`, Codex approval/sandbox bypass, and Claude Code permission bypass unless the caller explicitly opts into an `unsafe` policy override.
- PASS: CLI-backed external-agent drivers now cap retained events/output/stderr/event-content, support no-inherited-env execution with a minimal safe OS env baseline, redact configured secret values before events are stored/emitted, and include Windows process-tree termination on timeout/abort.
- PASS: External-agent CLI `cwd`, Codex `addDirs`, and Claude Code `mcpConfig`/`worktree` paths are validated against request ownership before provider processes start.
- PASS: Platform `capability.granted` audit events now include structured capability summaries without recording secret values.
- PASS: Platform sessions can run native harness `agentLoop()` workloads through `AgentLoopSessionRunner`, with policy-wrapped tools and durable report/failed-run artifacts.
- PASS: External-agent JSONL parsing now has provider-style Codex/Claude frame coverage, malformed-frame coverage, encrypted reasoning coverage, and array-recursive extraction for nested Claude tool frames.
- PASS: Failed platform-run external agents always produce a failed-run diagnosis artifact, and provider resume metadata is preserved as a sanitized summary.
- PASS: Built root package subpath exports are runtime- and type-smoke-tested in `verify:release`.
- PASS: Platform sessions can run compiled ONI/Swarm skeletons through `SwarmSessionRunner`.
- PASS: CLI, scheduled, GitHub webhook, chat command, and dependency alert trigger adapters now normalize launch events into `AgentTrigger` records; GitHub webhooks can be HMAC verified from the raw body.
- PASS: A local `platform-smoke` CLI command exercises trigger -> session -> local environment -> identity/capability grant -> external-agent runner -> durable artifact state.
- PASS: Reusable `ToolDefinition` policy wrappers can enforce tool capability, path, command, and network checks before tool code executes.
- PASS: `@oni.bot/tools` filesystem tools can accept a structural runtime policy for platform-enforced grant and path checks.
- PASS: Platform health and audit summary helpers expose queue depth, active sessions, rates, costs, event counts, and policy-denial sessions.
- PASS: GitHub artifact publication can create pull requests or issue/PR comments, mirror enriched artifacts locally, and return published URIs into session artifacts.
- PASS: HTTP and Cerebro execution environment providers can provision, release, and health-check remote devbox-style environments with sanitized failures.
- PASS: Generic tool, filesystem, code-execution (shell), and skill surfaces now expose opt-in runtime policy hooks; artifact/output secret redaction is shared across runners; the checkpoint surface is host-configured (not an agent-supplied-path vector). Callers opt in or run through the platform runner, which wraps tools by default.
- WARN: Non-GitHub artifact publication targets are still caller-owned.

## Priority 0 - Release Gate Must Be Honest

Status: Complete for the current root release gate as of 2026-05-23.

Goal: make local verification match production CI/release expectations.

Tasks:

1. Fix strict typecheck failures in `src/harness/loop/tools.ts` and `src/swarm/factories-advanced.ts`.
2. Add `typecheck:strict` to `package.json`.
3. Add `build:packages`, `audit:deps`, `pack:dry-run`, and `verify:release` scripts.
4. Make `verify:release` run:
   - `pnpm run verify`
   - `pnpm exec tsc --noEmit -p tsconfig.strict.json`
   - `pnpm --filter "./packages/**" run build`
   - `pnpm audit --prod --audit-level moderate`
   - `npm pack --dry-run`
5. Decide whether `packages/community` is a real package or a stub:
   - If real, add build/typecheck/test scripts.
   - If stub, document why it is excluded from package gates.
6. Fix the nested `vi.mock("stripe")` warning before the next Vitest upgrade turns it into a hard failure.

Exit gate:

```powershell
pnpm run verify:release
```

## Priority 1 - Dependency and Supply Chain Hardening

Status: Core audit blockers and package pack coverage are fixed as of 2026-05-23. Remaining work is routine patch upgrades.

Goal: reduce known vulnerable transitive paths and make dependency risk visible.

Tasks:

1. DONE: Update or override `brace-expansion` to a patched `5.0.6+` range where compatible.
2. DONE: Update or override the `ws` path to `8.20.1+`, or update the ActivePieces package chain if a compatible release exists.
3. DONE: Re-run `pnpm audit --prod --audit-level moderate` and record the result in this plan.
4. DONE: No dependency exception file is needed for the current advisories.
5. DONE: Align workspace `@oni.bot/core` peer dependency ranges to the current public compatibility target.
6. DONE: Add package-pack checks for publishable workspaces, not only the root package.

Exit gates:

```powershell
pnpm audit --prod --audit-level moderate
pnpm run pack:packages
```

## Priority 2 - Platform Production Backends

Status: Durable platform state and remote environment provider foundations are complete as of 2026-05-23.
JSON-file, SQLite, and Postgres session/artifact stores, GitHub artifact publication, a local
execution environment provider, HTTP/Cerebro environment providers, an external-agent session runner,
CLI/scheduled/GitHub-webhook/chat/dependency trigger adapters, and a local
platform smoke command are implemented.

Goal: move the background-agent platform from in-memory primitives to a usable production control plane.

Tasks:

1. Add durable `AgentSessionStore` implementations:
   - DONE: JSON-file local/single-node store.
   - DONE: SQLite for richer local/single-node use.
   - DONE: Postgres for service deployments.
2. Add durable `ArtifactStore` implementations:
   - DONE: JSON-file local/single-node artifact metadata store.
   - DONE: SQLite local/single-node artifact metadata store.
   - DONE: Postgres artifact metadata store.
   - DONE: GitHub-backed artifact publisher for PRs and issue/PR comments.
3. Add a real `ExecutionEnvironmentProvider`:
   - DONE: local session workspace provider.
   - DONE: HTTP/Cerebro devbox provider.
   - optional E2B/cloud sandbox provider behind package boundaries.
4. Add `AgentSessionRunner` adapters:
   - DONE: external driver runner for Codex/Claude-style `ExternalAgentDriver` instances.
   - DONE: harness `agentLoop` runner.
   - DONE: swarm runner for multi-agent workflows.
5. Add trigger adapters:
   - DONE: CLI trigger adapter and `platform-smoke` CLI path.
   - DONE: GitHub issue/PR/label/security webhook with optional signature verification.
   - DONE: cron/scheduled trigger adapter.
   - DONE: Chat command trigger adapter.
   - DONE: Dependency alert trigger adapter.
6. DONE: Add a platform smoke example that produces a durable report artifact from a local task.

Exit gate:

```powershell
pnpm exec vitest run src/platform src/harness/__tests__/ExternalAgent.test.ts
pnpm exec vitest run src/__tests__/cli-platform-smoke.test.ts
node dist/cli/index.js platform-smoke --dir .oni/platform-smoke
```

## Priority 3 - Runtime Policy Enforcement

Status: Complete as of 2026-06-04. Reusable tool policy wrappers, filesystem
tool runtime policy, and code-execution (`node_eval`/`e2b_sandbox`) runtime
policy now enforce grant, tool capability, command, and network checks below the
prompt layer. Secret redaction is applied to both external-agent and harness
`agentLoop` artifacts/output through a shared `redactSecrets` utility. The skill
surface (`SkillLoader`) accepts an opt-in path-scope policy. Unsafe Codex/Claude
CLI bypass options remain blocked by default. The checkpoint surface
(`WorkspaceCheckpointer`) operates only on a host-configured `workspaceDir` and
issues the host's own git commits, so it is not an agent-supplied-path bypass
vector; OS-level memory/CPU isolation is delegated to the execution environment
provider (E2B/devbox/cgroups), which is the correct layer for kernel resource
limits.

Goal: make `TaskSpec.scope`, identity, and capability grants enforce behavior, not just describe intent.

Tasks:

1. DONE: Compile platform `CapabilityGrant` into platform-run external-agent checks, opt-in core tool wrappers, the `@oni.bot/tools` filesystem runtime policy hook, and code-execution tool policy; checkpoint is host-configured and the skill surface has an opt-in policy hook.
2. DONE: Enforce path-scope validity and pass allowed/disallowed paths into platform-run external-agent ownership; opt-in tool wrappers, package filesystem tools, and the `SkillLoader` policy hook enforce path arguments.
3. DONE: Add command allowlists and command denial reasons in runtime policy helpers, platform runner required-command checks, opt-in tool wrappers, and code-execution tool policy.
4. DONE: Add network policy enforcement helpers, platform runner required-network checks, and code-execution tool network gating (`e2b_sandbox` requires a network grant):
   - `none`
   - `restricted`
   - `full`
5. DONE: Add secret broker boundaries:
   - explicit env allowlist per platform-run external-agent task.
   - artifact/output redaction for granted secret values, shared across external-agent and `agentLoop` runners via `redactSecrets`.
   - CLI external-agent drivers support no-inherited-env execution and stdout/stderr/event redaction controls; platform-run CLI agents disable broad inherited env by default.
6. DONE: Block dangerous external-agent driver settings by default:
   - Codex `dangerouslyBypassApprovalsAndSandbox`
   - Claude `bypassPermissions`
   - arbitrary `extraArgs` unless an explicit `unsafe` policy override allows them.
7. DONE: Add a structural `runtimePolicy` hook to `@oni.bot/tools` filesystem tools so platform callers can enforce grant, tool capability, and path scope without a direct package import of core internals.

Exit gate:

```powershell
pnpm exec vitest run src/platform src/harness packages/tools
```

Required tests:

- denied path cannot be read/written through platform-run tools.
- package filesystem tools delegate path/tool checks to runtime policy when provided.
- denied command cannot be passed through an external agent.
- DONE: secret env vars are not inherited by platform-run CLI external agents unless granted.
- audit logs record denials without leaking secret values.

## Priority 4 - External Agent Hardening

Status: Complete as of 2026-06-04. CLI driver output/event caps,
no-inherited-env execution, stdout/stderr/event redaction controls, Windows
process-tree termination, unsafe provider-option denial, and provider path scope
validation are implemented. Platform capability summaries are recorded in
audit events. Provider-style parser samples, malformed-frame coverage,
failed-run diagnosis/resume metadata, swarm runner support, and package
filesystem runtime-policy integration are implemented. A cross-platform
inactivity watchdog (`idleTimeoutMs`) now kills agents that produce no
stdout/stderr within the configured window, bounding hung/stalled background
runs on top of the existing wall-clock timeout and output caps. OS-level
memory/CPU limits are delegated to the execution environment provider, which is
the correct layer for kernel resource isolation.

Goal: make CLI-backed Codex/Claude sessions safe for long-running background execution.

Tasks:

1. DONE: Add stdout/stderr/event caps to `createCliExternalAgentDriver`.
2. DONE: Add child process tree termination on cancel/timeout, including Windows-safe behavior.
3. DONE: Add bounded event retention or streaming sinks so long runs cannot grow memory without limit.
4. DONE: Validate `cwd`, `addDirs`, `mcpConfig`, and worktree paths against session scope.
5. DONE: Add runtime capability summaries to audit events.
6. DONE: Add parser tests for real Codex/Claude JSONL samples, including malformed frames and encrypted reasoning blobs.
7. Add crash recovery semantics:
   - DONE: failed run diagnosis artifact.
   - DONE: resumable session metadata when supported by the provider.

Exit gate:

```powershell
pnpm exec vitest run src/harness/__tests__/ExternalAgent.test.ts src/platform
```

## Priority 5 - Coverage, Fuzzing, and Regression Quality

Goal: improve confidence where the current global coverage hides risk.

Current low-coverage areas from `pnpm run coverage:quality`:

Addressed as of 2026-06-04 by dedicated test suites:

- `src/lsp`: deeper branch coverage added (`src/__tests__/lsp-client-coverage.test.ts`, 38 cases).
- `src/cli`: command-handler branch coverage added (`src/__tests__/cli-commands-coverage.test.ts`, 36 cases).
- `packages/integrations/src/adapter/auth-resolver.ts`: covered (`auth-resolver-coverage.test.ts`, 14 cases).
- `packages/tools/src/github/index.ts`: covered (`github-coverage.test.ts`, 27 cases).
- `src/checkpointers/namespaced.ts` and `src/functional.ts`: now directly tested (from 0% — `namespaced-checkpointer.test.ts` and `functional.test.ts`).

Recently raised areas:

- `src/mcp`: 70.68% statements after real stdio transport integration coverage.
- `src/messages`: 100% statements.
- `src/prebuilt`: 100% statements after ReAct graph-loop and tool-node coverage.
- `src/tools`: 95% statements.

Tasks:

1. DONE: Add module-specific thresholds for security-sensitive surfaces:
   - MCP transport/client.
   - LSP client.
   - external-agent driver.
   - platform control plane.
   - filesystem/code execution tools.
2. DONE: Add fuzz/property tests (via `fast-check`) for:
   - JSON/SSE parsers.
   - tool argument validation.
   - path normalization (`src/__tests__/fuzz-paths.test.ts` proves no scoped path escapes the workspace root).
   - model response parsing.
   - artifact/audit serialization (`src/__tests__/fuzz-serialization.test.ts` round-trips records without loss).
3. DONE: Convert known flaky timing tests to deterministic synchronization patterns; the circuit-breaker half-open integration test now uses fake timers.
4. DONE: Add integration tests for package subpath imports after build.
5. DONE: Add coverage tracking and make thresholds blocking in `coverage:quality` and `verify:release`.

Exit gate:

```powershell
pnpm run test:coverage
```

Target:

- Keep global statements/lines above 80%.
- Raise critical module branches above 75%.
- No module under 50% unless explicitly documented as type-only or adapter-only.

## Priority 6 - Observability and Operations

Goal: make failures diagnosable in live background-agent fleets.

Tasks:

1. DONE: Define a stable, versioned event taxonomy for external agents (`src/platform/event-taxonomy.ts`, `EXTERNAL_AGENT_EVENT_TAXONOMY_VERSION`) mapping each raw event type to a lifecycle phase and terminal flag for platform observability.
2. DONE: Add structured logger injection. An injectable `LoggerLike` with a console-backed default and process-wide `setDefaultLogger` lives in `src/logger.ts` (exported from the root). Every non-CLI core library module (`models`, `swarm`, `harness`, `mcp`, `lsp`, `config`, `coordination`, `events`, `guardrails`, `pregel`) now logs through `getLogger()` instead of `console.*`. Standalone workspace packages (e.g. `@oni.bot/a2a`) keep `console.*` by design — coupling them to core solely for logging is undesirable; packages that already depend on core can adopt the exported `getLogger`.
3. DONE: Add OpenTelemetry-style spans around:
   - routing
   - environment provisioning
   - identity/capability issue/revoke
   - runner execution
   - artifact publication
   - review decisions
4. DONE: Add session health snapshots:
   - queue depth
   - active sessions
   - average duration
   - cancellation/failure rate
   - cost estimate
5. DONE: Add runbook docs for stuck sessions, failed providers, and audit review.

Exit gate:

```powershell
pnpm exec vitest run src/platform src/events src/telemetry.ts
```

## Priority 7 - Public API and Packaging Stability

Goal: prevent accidental breaking changes as the package surface grows.

Tasks:

1. DONE: Add type-level public API tests for every export subpath.
2. DONE: Add dist import smoke tests for every export subpath in `package.json`.
3. DONE: Add package tarball snapshot checks for root and publishable workspaces.
4. DONE: README/GUIDE examples match current exports (including `@oni.bot/core/platform`) and the `1.3.1` line; verified against `package.json` exports during this slice.
5. DONE: Decide whether source maps should ship in npm packages; document the decision.
6. DONE: Add a semver checklist to the PR template.

Exit gate:

```powershell
pnpm run build
npm pack --dry-run
node scripts/smoke-subpath-exports.mjs
node scripts/type-smoke-subpath-exports.mjs
node scripts/check-package-tarballs.mjs
```

## Priority 8 - Documentation and Repo Hygiene

Goal: keep future agents and maintainers aligned with the actual production path.

Tasks:

1. DONE: Decided — root `docs/` stays ignored as a local planning/workspace tree; the policy is documented inline in `.gitignore`.
2. DONE: Production-facing docs (README, GUIDE, SECURITY, OPERATIONS_RUNBOOK, PACKAGE_RELEASE_POLICY) live at the repo root for consumer visibility.
3. DONE: Production plans remain at the repo root; `.gitignore` explains the split.
4. DONE: Add a production-readiness checklist to the PR template.
5. DONE: `PROJECT_CONTEXT.md` is synchronized with this plan.
6. DONE: Local planning artifacts are documented in `.gitignore` as in-tree for maintainer continuity and excluded from npm tarballs by `check-package-tarballs.mjs` and the package `files` allowlist.

Exit gate:

```powershell
git status --short
git ls-files docs
```

## Recommended Execution Order

1. DONE: Fix strict typecheck and add `verify:release`.
2. DONE: Fix dependency audit advisories.
3. DONE: Align package peer ranges and package gates, including the `community` stub.
4. DONE: Add platform durable session/artifact stores and GitHub artifact publication.
5. DONE: Bridge platform sessions to external-agent runners.
6. DONE: Compile platform policy into external-agent, tool, filesystem, code-execution, and skill surfaces; secret redaction shared across runners.
7. DONE: Add CLI/scheduled trigger adapters, reusable tool policy wrappers, and one local platform smoke path.
8. DONE: Raise coverage on MCP/LSP/messages/prebuilt/tools/CLI/GitHub/auth-resolver plus the previously-uncovered functional and namespaced-checkpointer surfaces; added `fast-check` property suites for paths and serialization.
9. DONE: Add observability and runbooks; platform lifecycle logs/spans, runbooks, an injectable core-library logger, and a versioned external-agent event taxonomy are in place.
10. DONE: Lock public API with subpath import/type tests.

## Status: Complete

As of 2026-06-04 all nine priorities are complete and `verify:release` is green
end to end (including the new `audit:secrets` and `lint:budget` gate steps and
full coverage thresholds). Root suite: 316 files, 1842 passed, 2 skipped.

What this final pass added on top of the 2026-05-23 baseline:

- Runtime policy on code-execution tools (`node_eval`/`e2b_sandbox`) with network gating.
- Shared `redactSecrets` utility applied to `agentLoop` artifacts/output as well as external agents.
- Opt-in path-scope policy hook on `SkillLoader`.
- Cross-platform inactivity watchdog (`idleTimeoutMs`) for external agents.
- Injectable `LoggerLike` (`src/logger.ts`) with every non-CLI core library module migrated off `console.*`.
- Versioned external-agent event taxonomy (`src/platform/event-taxonomy.ts`).
- Coverage/fuzz suites for functional, namespaced checkpointer, LSP, CLI, GitHub tools, and auth resolver, plus `fast-check` property tests for path scope and serialization.
- A content secret scanner and a per-rule lint-warning budget, both blocking in `verify:release`.
- Dependency hardening: `axios` override raised to a patched `1.16.0`.

Remaining optional, non-blocking follow-ups (explicitly out of the production-ready
definition): logger adoption inside standalone workspace packages, an optional
E2B/cloud sandbox environment provider, and non-GitHub artifact publication targets.

Re-verify at any time with:

```powershell
pnpm run verify:release
git diff --check
```
