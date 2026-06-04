## Summary

<!-- What does this PR do? -->

## Type of change

- [ ] Bug fix
- [ ] Feature
- [ ] Refactor (no behavior change)
- [ ] Tests only
- [ ] Docs only

## Core Runtime Checklist

_Complete if you modified `src/pregel/`, `src/graph.ts`, `src/hitl/`, `src/checkpoint.ts`, or `src/events/`._

- [ ] Read `docs/RUNTIME_DESIGN.md` — this change is consistent with all documented invariants
- [ ] Added or updated tests in `src/__tests__/core-invariants/` for touched behaviors
- [ ] `pnpm run typecheck && pnpm run lint && pnpm test && pnpm run build` all pass locally
- [ ] No new `as any` in production source (or documented with `// SAFE:` comment)

## Harness Checklist

_Complete if you modified `src/harness/`._

- [ ] Memory lifecycle (wake/orient/match) behavior unchanged or tested
- [ ] Hooks fire in correct order for SessionStart, PostToolUse, SessionEnd
- [ ] AbortSignal propagation works through new code

## HITL / Checkpointing Checklist

_Complete if you modified checkpointing or HITL code._

- [ ] Thread isolation test passes (two threads same checkpointer, no bleed)
- [ ] HITL resume test passes (interrupt → resume delivers value to correct node)
- [ ] forkFrom() creates divergent thread without mutating source

## Platform / Agent Session Checklist

_Complete if you modified `src/platform/`, `src/harness/`, external-agent providers, tool policy, or package tools._

- [ ] Task scope and capability grants are enforced in code below the prompt layer
- [ ] Policy denials are auditable and do not leak secret values
- [ ] Failed background-agent runs produce a reviewable artifact or failed-run diagnosis
- [ ] Provider output retention, timeouts, aborts, and resume metadata remain bounded and sanitized
- [ ] Platform docs/runbooks were updated if lifecycle, policy, artifact, or audit behavior changed

## Release / Packaging Checklist

_Complete for public API, package, dependency, or release-gate changes._

- [ ] `pnpm run verify:release` passes locally
- [ ] `git diff --check` passes
- [ ] Public export changes are covered by runtime and type export smoke checks
- [ ] Package file-list changes are covered by `pnpm run pack:snapshot`
- [ ] Source-map behavior matches `PACKAGE_RELEASE_POLICY.md`
- [ ] README/GUIDE, `PROJECT_CONTEXT.md`, `PRODUCTION_HARDENING_PLAN.md`, and changelog entries are updated as needed

## Semver Checklist

- [ ] Patch: bug fix, security hardening, or internal implementation change with compatible API
- [ ] Minor: new compatible public API, package export, or optional behavior
- [ ] Major: breaking API, packaging, runtime, or policy behavior change
- [ ] Version and changelog entries match the selected semver level
