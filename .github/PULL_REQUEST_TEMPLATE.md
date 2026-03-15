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
- [ ] `npm run typecheck && npm run lint && npm test && npm run build` all pass locally
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
