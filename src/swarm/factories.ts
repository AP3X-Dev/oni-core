// ============================================================
// src/swarm/factories.ts — SwarmGraph topology factory functions
// Each function receives a pre-constructed SwarmGraph<S> instance,
// wires it for the requested topology, and returns it.
//
// `import type { SwarmGraph }` is used to avoid a runtime circular dep:
//   graph.ts → factories.ts → (type-only) graph.ts
// ============================================================

import { START, END, Command, Send } from "../types.js";
import type { ChannelSchema } from "../types.js";
import type { ONIConfig, NodeReturn } from "../types.js";
import type { SwarmAgentDef, SupervisorConfig } from "./types.js";
import type {
  BaseSwarmState, HierarchicalConfig, FanOutConfig, PipelineConfig,
  PeerNetworkConfig, MapReduceConfig, DebateConfig, HierarchicalMeshConfig,
} from "./config.js";
import { runWithTimeout } from "../internal/timeout.js";

// SwarmGraph — import type ONLY to avoid runtime circular dep
import type { SwarmGraph } from "./graph.js";

// ----------------------------------------------------------------
// buildHierarchical
// ----------------------------------------------------------------

export function buildHierarchical<S extends BaseSwarmState>(
  config: HierarchicalConfig<S>,
  swarm: SwarmGraph<S>,
): SwarmGraph<S> {
  for (const agentDef of config.agents) {
    swarm.addAgent(agentDef);
  }

  swarm.addSupervisor({
    model: config.supervisor.model,
    strategy: config.supervisor.strategy,
    taskField: "task" as keyof S,
    contextField: "context" as keyof S,
    rules: config.supervisor.rules,
    systemPrompt: config.supervisor.systemPrompt,
    maxRounds: config.supervisor.maxRounds,
    deadlineMs: config.supervisor.deadlineMs,
    autoRecover: config.supervisor.autoRecover,
  } as SupervisorConfig<S>);

  swarm.onErrorPolicy = config.onError ?? "fallback";

  return swarm;
}

// ----------------------------------------------------------------
// buildFanOut
// ----------------------------------------------------------------

export function buildFanOut<S extends BaseSwarmState>(
  config: FanOutConfig<S>,
  swarm: SwarmGraph<S>,
): SwarmGraph<S> {
  const agentIds = config.agents.map((a) => a.id);
  const maxConcurrency = config.maxConcurrency;
  const timeoutMs = config.timeoutMs;
  const weights = config.weights;

  // Register agents in registry (but don't use addAgent — we wire manually)
  for (const agentDef of config.agents) {
    swarm.registry.register(agentDef);
    swarm.agentIds.add(agentDef.id);
  }

  // Single orchestrator node that runs agents with concurrency/timeout control
  swarm.inner.addNode("__fanout_runner__", async (state: S, cfg?) => {
    const agentMap = new Map(config.agents.map((a) => [a.id, a]));

    async function runAgent(id: string): Promise<{ id: string; result: unknown; error: unknown | null }> {
      const agent = agentMap.get(id)!;
      try {
        await agent.hooks?.onStart?.(id, state as Record<string, unknown>);
        const result = await runWithTimeout(
          () => agent.skeleton.invoke(
            { ...state } as S,
            { ...cfg, agentId: id },
          ),
          timeoutMs,
          () => new Error(`Agent "${id}" timed out after ${timeoutMs}ms`),
        );
        await agent.hooks?.onComplete?.(id, result);
        return { id, result, error: null };
      } catch (err) {
        await agent.hooks?.onError?.(id, err);
        return { id, result: null, error: err };
      }
    }

    let allResults: Array<{ id: string; result: unknown; error: unknown | null }>;

    if (maxConcurrency != null && maxConcurrency > 0) {
      // Batched execution with concurrency limit
      allResults = [];
      const remaining = [...agentIds];
      while (remaining.length > 0) {
        const batch = remaining.splice(0, maxConcurrency);
        const batchResults = await Promise.all(batch.map(runAgent));
        allResults.push(...batchResults);
      }
    } else {
      // All in parallel
      allResults = await Promise.all(agentIds.map(runAgent));
    }

    // Collect results
    const agentResults: Record<string, unknown> = { ...(state.agentResults ?? {}) };
    for (const { id, result, error } of allResults) {
      if (error) {
        agentResults[id] = {
          _error: true,
          agent: id,
          error: String(error instanceof Error ? error.message : error),
        };
      } else {
        agentResults[id] = result;
      }
    }

    // Run reducer with weights
    const reduced = config.reducer(agentResults, weights);
    return { agentResults, ...reduced } as Partial<S>;
  });

  swarm.inner.addEdge(START, "__fanout_runner__");
  swarm.inner.addEdge("__fanout_runner__", END);

  return swarm;
}

// ----------------------------------------------------------------
// buildPipeline
// ----------------------------------------------------------------

export function buildPipeline<S extends BaseSwarmState>(
  config: PipelineConfig<S>,
  swarm: SwarmGraph<S>,
): SwarmGraph<S> {
  if (config.stages.length === 0) {
    throw new Error("SwarmGraph.pipeline: stages must contain at least one agent.");
  }
  const ids = config.stages.map((a) => a.id);

  for (const agentDef of config.stages) {
    swarm.addAgent(agentDef);
  }

  // Wire: START → first stage
  swarm.inner.addEdge(START, ids[0]!);

  // Wire each stage to the next (or conditional)
  for (let i = 0; i < ids.length - 1; i++) {
    const id = ids[i]!;
    if (config.transitions?.[id]) {
      swarm.addConditionalHandoff(id, config.transitions[id]!);
    } else {
      swarm.inner.addEdge(id, ids[i + 1]!);
    }
  }

  // Wire last stage
  const lastId = ids[ids.length - 1]!;
  if (config.transitions?.[lastId]) {
    swarm.addConditionalHandoff(lastId, config.transitions[lastId]!);
  } else {
    swarm.inner.addEdge(lastId, END);
  }

  return swarm;
}

// ----------------------------------------------------------------
// buildPeerNetwork
// ----------------------------------------------------------------

export function buildPeerNetwork<S extends BaseSwarmState>(
  config: PeerNetworkConfig<S>,
  swarm: SwarmGraph<S>,
): SwarmGraph<S> {
  for (const agentDef of config.agents) {
    swarm.addAgent(agentDef);
  }

  // Wire: START → entrypoint
  swarm.inner.addEdge(START, config.entrypoint);

  // Wire each agent's conditional handoff
  for (const [agentId, handoffFn] of Object.entries(config.handoffs)) {
    swarm.addConditionalHandoff(agentId, handoffFn as (state: S) => string | typeof END);
  }

  return swarm;
}

// ----------------------------------------------------------------
// buildMapReduce
// ----------------------------------------------------------------

export function buildMapReduce<S extends BaseSwarmState>(
  config: MapReduceConfig<S>,
  swarm: SwarmGraph<S>,
): SwarmGraph<S> {
  const poolSize = config.poolSize ?? 1;
  if (poolSize < 1) {
    throw new Error("SwarmGraph.mapReduce: poolSize must be at least 1.");
  }

  // Register poolSize copies of the mapper agent
  const mapperIds: string[] = [];
  for (let i = 0; i < poolSize; i++) {
    const id = poolSize === 1 ? config.mapper.id : `${config.mapper.id}_${i}`;
    mapperIds.push(id);
    swarm.addAgent({
      ...config.mapper,
      id,
    });
  }

  // Splitter node: passthrough — the conditional edge handles fan-out via Send
  swarm.inner.addNode("__splitter__", (_state: S) => {
    return {};
  });

  // Reducer node: collects agentResults and applies user reducer
  swarm.inner.addNode("__reducer__", (state: S) => {
    return config.reducer(state.agentResults ?? {});
  });

  // Wiring: START → __splitter__
  swarm.inner.addEdge(START, "__splitter__");

  // __splitter__ → Send to mapper agents using the configured poolStrategy
  const inputField = config.inputField;
  const strategy = config.poolStrategy ?? "round-robin";
  swarm.inner.addConditionalEdges("__splitter__", ((state: S) => {
    const items = state[inputField];
    if (!Array.isArray(items) || items.length === 0) {
      return "__reducer__";
    }

    // Per-batch assignment counts — used by least-busy strategy
    const assignCounts = new Map(mapperIds.map((id) => [id, 0]));

    return items.map((item: unknown, idx: number) => {
      let targetId: string;

      if (strategy === "random") {
        targetId = mapperIds[Math.floor(Math.random() * mapperIds.length)]!;
      } else if (strategy === "least-busy") {
        // Pick the mapper with fewest assignments in this batch so far
        let minCount = Infinity;
        let minId = mapperIds[0]!;
        for (const id of mapperIds) {
          const c = assignCounts.get(id) ?? 0;
          if (c < minCount) { minCount = c; minId = id; }
        }
        targetId = minId;
      } else {
        // round-robin (default)
        targetId = mapperIds[idx % mapperIds.length]!;
      }

      assignCounts.set(targetId, (assignCounts.get(targetId) ?? 0) + 1);
      return new Send(targetId, { ...state, task: String(item) });
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any); // SAFE: external boundary — Send[] return is valid but not in addConditionalEdges overload signature

  // Each mapper → __reducer__
  for (const id of mapperIds) {
    swarm.inner.addEdge(id, "__reducer__");
  }

  // __reducer__ → END
  swarm.inner.addEdge("__reducer__", END);

  return swarm;
}

// ----------------------------------------------------------------
// buildDebate
// ----------------------------------------------------------------

export function buildDebate<S extends BaseSwarmState>(
  config: DebateConfig<S>,
  swarm: SwarmGraph<S>,
): SwarmGraph<S> {
  if (config.debaters.length === 0) {
    throw new Error("SwarmGraph.debate: debaters must contain at least one agent.");
  }
  const debaterIds = config.debaters.map((d) => d.id);
  const consensusKeyword = config.judge.consensusKeyword ?? "CONSENSUS";

  for (const debater of config.debaters) {
    swarm.addAgent(debater);
  }

  const scoreDebaters = config.judge.scoreDebaters ?? false;
  const consensusThreshold = config.judge.consensusThreshold;

  // Judge node: evaluates arguments, decides continue or consensus
  swarm.inner.addNode("__judge__", async (state: S) => {
    const round = state.supervisorRound ?? 0;

    // If no agent results yet (first round), just kick off debaters
    const results = state.agentResults ?? {};
    if (round === 0 && Object.keys(results).length === 0) {
      return {
        supervisorRound: round + 1,
      } as Partial<S>;
    }

    // Evaluate arguments via judge model
    const argsText = Object.entries(results)
      .map(([id, r]) => `${id}: ${JSON.stringify(r)}`)
      .join("\n\n");

    const scoreInstruction = scoreDebaters
      ? `\nAlso provide a JSON object with scores for each debater and a verdict. Format: {"scores": {"debater_id": score}, "verdict": "CONTINUE" or "${consensusKeyword}"}`
      : "";

    const response = await config.judge.model.chat({
      messages: [{
        role: "user",
        content: `Round ${round}. Evaluate these arguments:\n\n${argsText}\n\nRespond "${consensusKeyword}" if consensus reached, otherwise "CONTINUE".${scoreInstruction}`,
      }],
      systemPrompt: config.judge.systemPrompt ?? "You are a debate judge.",
    });

    let isConsensus = false;
    let roundScores: Record<string, number> | undefined;
    const existingScores = ((state.context as Record<string, unknown>).debateScores ?? []) as Array<{ round: number; scores: Record<string, number> }>;

    // Try to parse structured response (JSON with scores + verdict)
    if (scoreDebaters) {
      try {
        const parsed = JSON.parse(response.content);
        if (parsed.scores) {
          roundScores = parsed.scores;
        }
        if (parsed.verdict) {
          isConsensus = parsed.verdict.includes(consensusKeyword);
        }
      } catch {
        // Fallback to keyword detection
        isConsensus = response.content.includes(consensusKeyword);
      }

      // Check consensus threshold if scores available
      if (!isConsensus && roundScores && consensusThreshold != null) {
        const scoreValues = Object.values(roundScores);
        if (scoreValues.length >= 2) {
          const spread = Math.max(...scoreValues) - Math.min(...scoreValues);
          if (spread <= consensusThreshold) {
            isConsensus = true;
          }
        }
      }
    } else {
      isConsensus = response.content.includes(consensusKeyword);
    }

    const nextRound = round + 1;

    // Force done if consensus or max rounds exhausted
    const isDone = isConsensus || nextRound >= config.judge.maxRounds;

    const updatedScores = roundScores
      ? [...existingScores, { round, scores: roundScores }]
      : existingScores;

    return {
      done: isDone,
      supervisorRound: nextRound,
      context: {
        ...(state.context ?? {}),
        ...(scoreDebaters ? { debateScores: updatedScores } : {}),
      },
      messages: [{ role: "system", content: `Judge round ${round}: ${isDone ? "Consensus" : "Continue"}` }],
    } as Partial<S>;
  });

  // Fan-out node: passthrough — conditional edges handle the Send dispatch
  swarm.inner.addNode("__fanout__", (_state: S) => {
    return {};
  });

  // Wiring: START → __judge__
  swarm.inner.addEdge(START, "__judge__");

  // __judge__ → conditional (done → END, else → __fanout__)
  swarm.inner.addConditionalEdges("__judge__", (state: S) => {
    if (state.done) return END;
    return "__fanout__";
  });

  // __fanout__ → Send to all debaters in parallel
  swarm.inner.addConditionalEdges("__fanout__", ((state: S) =>
    debaterIds.map((id) => new Send(id, { ...state }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) as any); // SAFE: external boundary — Send[] return is valid but not in addConditionalEdges overload signature

  // Each debater → __judge__
  for (const id of debaterIds) {
    swarm.inner.addEdge(id, "__judge__");
  }

  return swarm;
}

// ----------------------------------------------------------------
// buildHierarchicalMesh
// SPECIAL CASE: makeSwarm callback used instead of SwarmGraph static methods
// to avoid runtime circular dependency (SwarmGraph is import type only).
// ----------------------------------------------------------------

export function buildHierarchicalMesh<S extends BaseSwarmState>(
  config: HierarchicalMeshConfig<S>,
  swarm: SwarmGraph<S>,
  makeSwarm: (channels?: Partial<ChannelSchema<S>>) => SwarmGraph<S>,
): SwarmGraph<S> {
  const teamIds = Object.keys(config.teams);
  const maxRounds = config.coordinator.maxRounds ?? 10;

  // Build each team as a compiled sub-skeleton and mount as a node
  for (const [teamId, teamConfig] of Object.entries(config.teams)) {
    let teamSwarm: SwarmGraph<S>;

    if (teamConfig.topology === "pipeline") {
      teamSwarm = buildPipeline<S>({ stages: teamConfig.agents }, makeSwarm());
    } else {
      teamSwarm = buildPeerNetwork<S>({
        agents: teamConfig.agents,
        entrypoint: teamConfig.agents[0]!.id,
        handoffs: teamConfig.handoffs ?? {},
      }, makeSwarm());
    }

    const teamSkeleton = teamSwarm.compile();

    // Mount team as a single node in the outer graph.
    // Spread all top-level fields from teamResult (including done, context)
    // so they propagate to the outer coordinator state.
    swarm.inner.addNode(teamId, async (state: S, cfg?) => {
      const teamResult = await teamSkeleton.invoke(state as S, cfg);
      return {
        ...(teamResult as object),
        agentResults: {
          ...(state.agentResults ?? {}),
          [teamId]: teamResult,
        },
      } as Partial<S>;
    });
  }

  // Coordinator node: routes to teams
  swarm.inner.addNode("__coordinator__", async (state: S) => {
    const round = state.supervisorRound ?? 0;

    if (round >= maxRounds || state.done) {
      return { done: true } as Partial<S>;
    }

    if (config.coordinator.strategy === "llm" && config.coordinator.model) {
      const teamList = teamIds.map((id) => `- ${id}`).join("\n");
      const response = await config.coordinator.model.chat({
        messages: [{
          role: "user",
          content: `Task: ${state.task}\n\nAvailable teams:\n${teamList}\n\nRespond with the team name to route to, or "DONE" if complete.`,
        }],
        systemPrompt: config.coordinator.systemPrompt ?? "You coordinate teams.",
      });

      const picked = response.content.trim();
      if (picked === "DONE" || !teamIds.includes(picked)) {
        return { done: true, supervisorRound: round + 1 } as Partial<S>;
      }

      return new Command<S>({
        update: { supervisorRound: round + 1, currentAgent: picked } as Partial<S>,
        goto: picked,
      });
    }

    // Round-robin strategy: route to teams in order, mark done after all visited
    if (config.coordinator.strategy === "round-robin") {
      const target = teamIds[round % teamIds.length]!;
      if (round >= teamIds.length) {
        return { done: true } as Partial<S>;
      }
      return new Command<S>({
        update: { supervisorRound: round + 1 } as Partial<S>,
        goto: target,
      });
    }

    // Rule-based strategy: evaluate rules in order, route to the first match
    if (config.coordinator.strategy === "rule") {
      const rules = config.coordinator.rules ?? [];
      const task = String((state as Record<string, unknown>).task ?? "");
      const ctx = ((state as Record<string, unknown>).context ?? {}) as Record<string, unknown>;
      for (const rule of rules) {
        if (rule.condition(task, ctx)) {
          return new Command<S>({
            update: { supervisorRound: round + 1, currentAgent: rule.agentId } as Partial<S>,
            goto: rule.agentId,
          });
        }
      }
      // No matching rule — done
      return { done: true, supervisorRound: round + 1 } as Partial<S>;
    }

    return { done: true } as Partial<S>;
  });

  // Wiring: START → coordinator
  swarm.inner.addEdge(START, "__coordinator__");

  // Each team → coordinator (loop back unless done)
  for (const teamId of teamIds) {
    swarm.inner.addConditionalEdges(teamId, (state: S) => {
      if (state.done) return END;
      return "__coordinator__";
    });
  }

  // Coordinator → conditional (done → END, else handled by Command.goto)
  swarm.inner.addConditionalEdges("__coordinator__", (state: S) => {
    if (state.done) return END;
    // Command.goto handles routing — this is the fallback
    return END;
  });

  return swarm;
}

// ----------------------------------------------------------------
// buildRace
// ----------------------------------------------------------------

export function buildRace<S extends BaseSwarmState>(
  config: {
    agents: SwarmAgentDef<S>[];
    accept?: (result: unknown) => boolean;
    timeoutMs?: number;
    channels?: Partial<ChannelSchema<S>>;
  },
  swarm: SwarmGraph<S>,
): SwarmGraph<S> {
  const accept = config.accept ?? (() => true);
  const timeoutMs = config.timeoutMs;

  // Register agents so they appear in the registry
  for (const agentDef of config.agents) {
    swarm.registry.register(agentDef);
    swarm.agentIds.add(agentDef.id);
  }

  // Single node that races all agents — resolves as soon as one produces
  // an acceptable result (true Promise.race semantics, not Promise.all).
  swarm.inner.addNode("__race__", async (state: S, cfg?) => {
    type RaceResult = { id: string; result: unknown; error: unknown | null };

    const agentPromises: Promise<RaceResult>[] = config.agents.map((agent) => {
      const p: Promise<RaceResult> = agent.skeleton
        .invoke({ ...state } as S, { ...cfg, agentId: agent.id })
        .then(
          (result) => ({ id: agent.id, result, error: null } as RaceResult),
          (err)    => ({ id: agent.id, result: null, error: err } as RaceResult),
        );

      if (timeoutMs != null) {
        let timer: ReturnType<typeof setTimeout>;
        const timeoutPromise = new Promise<RaceResult>((resolve) => {
          timer = setTimeout(
            () => resolve({ id: agent.id, result: null, error: new Error("timeout") }),
            timeoutMs,
          );
        });
        return Promise.race([p, timeoutPromise]).finally(() => clearTimeout(timer));
      }
      return p;
    });

    // Resolve as soon as the first acceptable result arrives.
    const winner = await new Promise<RaceResult | null>((resolve) => {
      let remaining = agentPromises.length;
      if (remaining === 0) { resolve(null); return; }

      for (const p of agentPromises) {
        p.then((r) => {
          let accepted = false;
          try {
            accepted = !r.error && accept(r.result);
          } catch {
            // accept() threw — treat as not accepted to keep remaining decrement working
          }
          if (accepted) {
            resolve(r);
          } else {
            remaining--;
            if (remaining === 0) resolve(null);
          }
        });
      }
    });

    if (winner) {
      return {
        agentResults: { [winner.id]: winner.result },
        context: { ...(state.context ?? {}), raceWinner: winner.id },
      } as unknown as Partial<S>;
    }

    // No acceptable result
    return {
      context: {
        ...(state.context ?? {}),
        raceError: "No agent produced an acceptable result",
      },
    } as unknown as Partial<S>;
  });

  swarm.inner.addEdge(START, "__race__");
  swarm.inner.addEdge("__race__", END);

  return swarm;
}

// ----------------------------------------------------------------
// buildDag
// ----------------------------------------------------------------

export function buildDag<S extends BaseSwarmState>(
  config: {
    agents: SwarmAgentDef<S>[];
    dependencies: Record<string, string[]>;
    channels?: Partial<ChannelSchema<S>>;
  },
  swarm: SwarmGraph<S>,
): SwarmGraph<S> {
  const agentMap = new Map(config.agents.map((a) => [a.id, a]));

  // Validate dependencies
  for (const [_node, deps] of Object.entries(config.dependencies)) {
    for (const dep of deps) {
      if (!agentMap.has(dep)) {
        throw new Error(`Dependency "${dep}" not found in agents list.`);
      }
    }
  }

  // Cycle detection via topological sort
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const sorted: string[] = [];

  function visit(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Cycle detected involving "${id}".`);
    visiting.add(id);
    for (const dep of config.dependencies[id] ?? []) {
      visit(dep);
    }
    visiting.delete(id);
    visited.add(id);
    sorted.push(id);
  }

  for (const agent of config.agents) {
    visit(agent.id);
  }

  for (const agent of config.agents) {
    swarm.addAgent(agent);
  }

  // Group agents into layers based on dependencies
  const deps = config.dependencies;

  // For DAG execution: use a single orchestrator node
  swarm.inner.addNode("__dag_runner__", async (state: S, cfg?) => {
    const results: Record<string, unknown> = {};
    const completed = new Set<string>();

    // Process in topological order
    // Group into parallel batches
    const remaining = new Set(sorted);
    while (remaining.size > 0) {
      // Find all nodes whose deps are satisfied
      const ready: string[] = [];
      for (const id of remaining) {
        const idDeps = deps[id] ?? [];
        if (idDeps.every((d) => completed.has(d))) {
          ready.push(id);
        }
      }

      if (ready.length === 0) {
        const stuck = [...remaining].join(', ');
        throw new Error(`buildDag: circular or unsatisfiable dependency detected. Stuck nodes: ${stuck}`);
      }

      // Execute ready nodes in parallel
      const batchResults = await Promise.all(
        ready.map(async (id) => {
          const agent = agentMap.get(id)!;
          const result = await agent.skeleton.invoke(
            { ...state, agentResults: { ...(state.agentResults ?? {}), ...results } } as S,
            { ...cfg, agentId: id },
          );
          return { id, result };
        }),
      );

      for (const { id, result } of batchResults) {
        results[id] = result;
        completed.add(id);
        remaining.delete(id);
      }
    }

    return {
      agentResults: { ...(state.agentResults ?? {}), ...results },
    } as Partial<S>;
  });

  // Wire: START → __dag_runner__ → END
  // Remove any edges added by addAgent — reset private edges field
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (swarm.inner as any).edges = []; // SAFE: external boundary — clearing private StateGraph.edges to rewire DAG topology
  swarm.inner.addEdge(START, "__dag_runner__");
  swarm.inner.addEdge("__dag_runner__", END);

  return swarm;
}

// ----------------------------------------------------------------
// buildPool
// ----------------------------------------------------------------

export function buildPool<S extends BaseSwarmState>(
  config: {
    agent: SwarmAgentDef<S>;
    poolSize: number;
    inputField: keyof S;
    reducer: (results: Record<string, unknown>) => Partial<S>;
    channels?: Partial<ChannelSchema<S>>;
  },
  swarm: SwarmGraph<S>,
): SwarmGraph<S> {
  const poolSize = config.poolSize;

  // Create pool copies
  const poolIds: string[] = [];
  for (let i = 0; i < poolSize; i++) {
    const id = poolSize === 1 ? config.agent.id : `${config.agent.id}_${i}`;
    poolIds.push(id);
    swarm.addAgent({ ...config.agent, id });
  }

  // Orchestrator node: dispatches items to pool agents and reduces
  swarm.inner.addNode("__pool_runner__", async (state: S, cfg?) => {
    const items = state[config.inputField];
    if (!Array.isArray(items) || items.length === 0) {
      return config.reducer({});
    }

    // Semaphore for concurrency control
    let running = 0;
    const results: Record<string, unknown> = {};
    const queue = items.map((item: unknown, idx: number) => ({
      item,
      idx,
      targetId: poolIds[idx % poolIds.length]!,
    }));

    await new Promise<void>((resolve, _reject) => {
      let completed = 0;
      const total = queue.length;

      function processNext() {
        while (running < poolSize && queue.length > 0) {
          const work = queue.shift()!;

          // Respect removeAgent() — if the assigned slot was removed, redirect
          // to an active pool slot; if none remain, mark the item as failed.
          let agentDef = swarm.registry.getDef(work.targetId) as SwarmAgentDef<S> | undefined;
          if (!agentDef) {
            const activeIds = poolIds.filter((id) => !!swarm.registry.getDef(id));
            if (activeIds.length > 0) {
              work.targetId = activeIds[work.idx % activeIds.length]!;
              agentDef = swarm.registry.getDef(work.targetId) as SwarmAgentDef<S>;
            } else {
              results[`item_${work.idx}`] = { _error: `Pool slot removed; no active agents remain` };
              completed++;
              if (completed === total) resolve();
              continue;
            }
          }

          running++;
          // Use the full wrapped agentNode (hooks, retries, timeout) stored
          // by addAgent() in swarm.inner.nodes rather than raw skeleton.invoke.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const wrappedFn = (swarm.inner as any).nodes.get(work.targetId)?.fn as // SAFE: external boundary — accessing private StateGraph.nodes map
            ((state: S, cfg?: ONIConfig) => Promise<NodeReturn<S>>) | undefined;
          const invocation = wrappedFn
            ? wrappedFn({ ...state, task: String(work.item) } as S, { ...cfg, agentId: work.targetId })
            : agentDef.skeleton.invoke(
                { ...state, task: String(work.item) } as S,
                { ...cfg, agentId: work.targetId },
              );
          invocation.then(
            (result: unknown) => {
              results[`item_${work.idx}`] = result;
              running--;
              completed++;
              if (completed === total) resolve();
              else processNext();
            },
            (err: unknown) => {
              results[`item_${work.idx}`] = { _error: String(err) };
              running--;
              completed++;
              if (completed === total) resolve();
              else processNext();
            },
          );
        }
      }

      if (total === 0) resolve();
      else processNext();
    });

    return config.reducer(results);
  });

  // Wire: START → __pool_runner__ → END (bypass agent edges)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (swarm.inner as any).edges = []; // SAFE: external boundary — clearing private StateGraph.edges to rewire pool topology
  swarm.inner.addEdge(START, "__pool_runner__");
  swarm.inner.addEdge("__pool_runner__", END);

  return swarm;
}

// ----------------------------------------------------------------
// buildCompose
// ----------------------------------------------------------------

export function buildCompose<S extends BaseSwarmState>(
  config: { stages: Array<{ id: string; swarm: SwarmGraph<S> }>; channels?: Partial<ChannelSchema<S>> },
  swarm: SwarmGraph<S>,
): SwarmGraph<S> {
  if (config.stages.length === 0) {
    throw new Error("SwarmGraph.compose: stages must contain at least one sub-swarm.");
  }
  const stageIds = config.stages.map((s) => s.id);

  for (const stage of config.stages) {
    const compiled = stage.swarm.compile();
    swarm.inner.addNode(stage.id, async (state: S, cfg?) => {
      const stageResult = await compiled.invoke(state as S, cfg);
      return {
        ...stageResult,
        agentResults: {
          ...(state.agentResults ?? {}),
          [stage.id]: stageResult,
        },
      } as Partial<S>;
    });
  }

  // Wire pipeline: START → stage1 → stage2 → ... → END
  swarm.inner.addEdge(START, stageIds[0]!);
  for (let i = 0; i < stageIds.length - 1; i++) {
    swarm.inner.addEdge(stageIds[i]!, stageIds[i + 1]!);
  }
  swarm.inner.addEdge(stageIds[stageIds.length - 1]!, END);

  return swarm;
}
