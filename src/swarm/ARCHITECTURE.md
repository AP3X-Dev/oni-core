# @oni.bot/core — Swarm Architecture

## The Problem with Running Graphs as "Swarms"

A naive swarm is just N agents running in parallel with shared state. That breaks down fast:

- Agents clobber each other's state writes
- No structured way for Agent A to say "Agent B should handle this"
- No concept of agent identity — who did what?
- No load distribution — work isn't routed to the right agent
- No topology — every agent sees everything, or nothing

## @oni.bot/core Swarm Primitives

### 1. Handoff (the core primitive)

`Handoff` is the swarm equivalent of `Command`. When an agent decides another agent
should take over a task, it returns a `Handoff`:

```ts
return new Handoff({
  to:      "research_agent",
  message: "Need you to look up the competitor landscape",
  context: { query: state.task, priority: "high" },
  resume:  "summarizer_agent",  // who to return to after
})
```

This is the key difference from just using Send: Handoff carries **agent identity**,
**resumption routing**, and a **message** — it's a first-class inter-agent communication.

### 2. SwarmAgent

An agent definition with:
- `id` — unique identity in the swarm
- `role` — what it does (researcher, coder, critic, planner...)
- `capabilities` — what tasks it can handle (used by Supervisor for routing)
- `skeleton` — its compiled ONISkeleton
- `maxConcurrency` — how many tasks it can handle simultaneously
- `privateState` — its own state schema (not shared with other agents)

### 3. Supervisor

The orchestrator node. Receives a task, decides which agent handles it, then collects
the result. Supports three routing strategies:

- **LLM routing** — uses an LLM to pick the best agent based on task + capabilities
- **Rule routing** — deterministic: `condition(task) → agentId`  
- **Round-robin** — load balancing across a pool of equivalent agents

The Supervisor itself is a node in a SwarmGraph — so it has full access to checkpointing,
streaming, interrupts, etc.

### 4. AgentRegistry

A live catalog of agents in the swarm. Supports:
- Register/deregister at runtime
- Lookup by id, role, or capability
- Status tracking (idle, busy, terminated)
- Used by Supervisor for routing decisions

### 5. AgentPool

Manages N instances of the same agent type. Handles:
- Concurrency limits per agent type
- Round-robin and least-busy load balancing
- Work queue with backpressure

### 6. SwarmGraph

Extends StateGraph with swarm-aware primitives:
- `addAgent(agent)` — registers an agent and wires its edges automatically
- `addSupervisor(config)` — mounts a supervisor with routing logic
- `addHandoffEdge(from, to)` — explicit agent-to-agent handoff wire
- Shared blackboard channels + per-agent private state namespacing

### 7. SwarmMessage / Mailbox

Agents can send messages to each other asynchronously via a mailbox system.
Each agent has an `inbox` channel (appendList) in the shared state.
Messages carry sender identity, content, and optional reply-to routing.

## Topology Models

### Hierarchical (Supervisor → Workers)
```
START → Supervisor → [Agent A | Agent B | Agent C] → Supervisor → END
```
Classic: supervisor routes, workers execute, results return to supervisor.

### Peer-to-Peer (Handoff mesh)
```
START → Agent A ↔ Agent B ↔ Agent C → END
```
Agents hand off directly to each other without a central coordinator.

### Pipeline
```
START → Planner → Researcher → Coder → Critic → END
```
Linear: each agent enriches state and passes forward.

### Hierarchical + Peer (ONI default for AgentOS ADE)
```
START → Supervisor
           ├→ SubSupervisor A → [Workers...]
           └→ SubSupervisor B → [Workers...]
        → Aggregator → END
```

## State Model

```
SwarmState<S> = {
  // Shared blackboard — all agents read/write
  blackboard: S

  // Per-agent private state — namespaced
  agentState: Record<agentId, AgentPrivateState>

  // Swarm-level metadata
  swarm: {
    activeAgents: string[]
    completedAgents: string[]
    handoffHistory: HandoffRecord[]
    messages: SwarmMessage[]
  }
}
```

## Key Design Decisions

1. **Handoff is NOT just a Send** — it carries identity + resumption semantics
2. **Agents are ONISkeletons** — full graph execution, not just functions
3. **Supervisor is a node** — fully composable, checkpointable, streamable
4. **Private state is namespaced** — prevents clobbering via `agent:{id}:*` key prefix
5. **AgentRegistry is runtime-injectable** — swap agents at runtime without recompiling
6. **SwarmGraph compiles to a regular ONISkeleton** — fully compatible with existing API
