# ONI Core Architecture

## Module Ownership

| Module | Path | Responsibility | Key Invariants |
|--------|------|---------------|----------------|
| Pregel Engine | src/pregel/ | Superstep execution, node pipeline, streaming | Thread isolation, HITL lifecycle |
| Graph Builder | src/graph.ts | StateGraph DSL → compiled ONISkeletonV3 | Public API stability |
| Harness Loop | src/harness/loop/ | Think→Act→Observe agent generator | Retry/timeout, signal propagation |
| Harness Memory | src/harness/memory/ | Filesystem memory discovery + budgeting | Tier isolation, browser compat |
| Swarm | src/swarm/ | Multi-agent topology orchestration | Deadline-at-invoke scoping |
| Models | src/models/ | LLM adapter implementations | Retry/backoff, token streaming |
| HITL | src/hitl/ | Interrupt/resume protocol | resumeId integrity |
| EventBus | src/events/ | Typed lifecycle event routing | Listener fault isolation |
| Guardrails | src/guardrails/ | Budget, audit, content filters | BudgetExceededError never swallowed |
| Checkpointers | src/checkpoint.ts | Persistent state backends | Thread-scoped writes |

## Allowed Dependency Directions

```
CLI (oni-code/) → Harness → Swarm → Pregel → (types, events, checkpoint)
Harness → Models
Swarm → Pregel
Pregel → (circuit-breaker, dlq, telemetry, hitl, checkpoint, events, guardrails)
```

Cross-cutting violations (e.g., Pregel importing from Harness) require a code review comment explaining why and whether the dependency belongs in a shared module instead.

## Files Requiring Core Runtime Review

Changes to these files require invariant test coverage for every touched behavior:
- `src/pregel/streaming.ts` — superstep loop correctness
- `src/pregel/checkpointing.ts` — thread isolation
- `src/pregel/interrupts.ts` — HITL state persistence
- `src/pregel/execution.ts` — circuit breaker and retry correctness
- `src/harness/loop/inference.ts` — retry/timeout behavior
- `src/harness/memory/ranker.ts` — token budget correctness

## Key Invariants

See `docs/RUNTIME_DESIGN.md` for full detail. Summary:

1. Checkpoints scoped by threadId — no cross-thread state bleed.
2. Subgraph returns only update the keys explicitly returned.
3. interrupt() always saves checkpoint before suspending.
4. resume() re-runs only the interrupted node — not prior nodes.
5. EventBus listener errors never propagate to the emitter.
6. BudgetExceededError is never swallowed silently.
7. Circuit breaker open-state rejects calls without executing the user function.
