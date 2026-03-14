// ============================================================
// @oni.bot/core/swarm — SwarmGraph
// ============================================================
// Extends StateGraph with swarm-aware primitives:
//   - addAgent()         register an agent as a node
//   - addSupervisor()    mount supervisor routing node
//   - addHandoffEdge()   explicit agent-to-agent wires
//   - compile()          returns a full ONISkeleton
// ============================================================

import { StateGraph } from "../graph.js";
import { START, END, appendList, lastValue, mergeObject } from "../types.js";
import { Command, Send } from "../types.js";
import type {
  NodeFn, ONIConfig, ONISkeleton, ONICheckpointer, ChannelSchema, NodeReturn,
} from "../types.js";
import type { ONIModel } from "../models/types.js";
import type {
  SwarmAgentDef, SupervisorConfig, SwarmMeta, HandoffRecord, SwarmMessage,
  AgentCapability,
} from "./types.js";
import { Handoff } from "./types.js";
import { AgentRegistry } from "./registry.js";
import { createSupervisorNode, type SupervisorState } from "./supervisor.js";
import { createMessage, getInbox } from "./mailbox.js";
import { RequestReplyBroker } from "../coordination/request-reply.js";
import { PubSub } from "../coordination/pubsub.js";
import { runWithTimeout } from "../internal/timeout.js";

// ----------------------------------------------------------------
// Default swarm state channels
// ----------------------------------------------------------------

export type BaseSwarmState = {
  task:            string;
  context:         Record<string, unknown>;
  agentResults:    Record<string, unknown>;
  messages:        Array<{ role: string; content: string }>;
  swarmMessages:   SwarmMessage[];
  supervisorRound: number;
  currentAgent:    string | null;
  done:            boolean;
  handoffHistory:  HandoffRecord[];
  [key: string]:   unknown;
};

export const baseSwarmChannels = {
  task:            lastValue(() => ""),
  context:         mergeObject(() => ({})),
  agentResults:    mergeObject(() => ({})),
  messages:        appendList(() => [] as Array<{ role: string; content: string }>),
  swarmMessages:   appendList(() => [] as SwarmMessage[]),
  supervisorRound: lastValue(() => 0),
  currentAgent:    lastValue((): string | null => null),
  done:            lastValue(() => false),
  handoffHistory:  appendList(() => [] as HandoffRecord[]),
};

// ----------------------------------------------------------------
// HierarchicalConfig — config object for the hierarchical template
// ----------------------------------------------------------------

export interface HierarchicalConfig<S extends BaseSwarmState> {
  supervisor: {
    model?: ONIModel;
    strategy: "llm" | "rule" | "round-robin";
    rules?: Array<{ condition: (task: string, context: Record<string, unknown>) => boolean; agentId: string }>;
    systemPrompt?: string;
    maxRounds?: number;
    /** Whole-swarm deadline in ms, computed from invoke-time (not compile-time). */
    deadlineMs?: number;
    /** Auto-recover: when an agent errors, route to an idle agent with matching capability. */
    autoRecover?: boolean;
  };
  agents: SwarmAgentDef<S>[];
  channels?: Partial<ChannelSchema<S>>;
  onError?: "fallback" | "throw";
}

// ----------------------------------------------------------------
// FanOutConfig — config object for the fan-out template
// ----------------------------------------------------------------

export interface FanOutConfig<S extends BaseSwarmState> {
  agents: SwarmAgentDef<S>[];
  reducer: (agentResults: Record<string, unknown>, weights?: Record<string, number>) => Partial<S>;
  channels?: Partial<ChannelSchema<S>>;
  /** Max agents to run simultaneously (default: all). */
  maxConcurrency?: number;
  /** Per-agent timeout in ms. Agents that exceed this are marked with _error. */
  timeoutMs?: number;
  /** Per-agent weights passed to the reducer as second argument. */
  weights?: Record<string, number>;
}

// ----------------------------------------------------------------
// PipelineConfig — config object for the pipeline template
// ----------------------------------------------------------------

export interface PipelineConfig<S extends BaseSwarmState> {
  stages: SwarmAgentDef<S>[];
  transitions?: Record<string, (state: S) => string | typeof END>;
  channels?: Partial<ChannelSchema<S>>;
}

// ----------------------------------------------------------------
// PeerNetworkConfig — config object for the peer network template
// ----------------------------------------------------------------

export interface PeerNetworkConfig<S extends BaseSwarmState> {
  agents: SwarmAgentDef<S>[];
  entrypoint: string;
  handoffs: Record<string, (state: S) => string | typeof END>;
  channels?: Partial<ChannelSchema<S>>;
}

// ----------------------------------------------------------------
// MapReduceConfig — config object for the map-reduce template
// ----------------------------------------------------------------

export interface MapReduceConfig<S extends BaseSwarmState> {
  mapper: SwarmAgentDef<S>;
  poolSize?: number;
  poolStrategy?: "round-robin" | "least-busy" | "random";
  inputField: keyof S;
  reducer: (agentResults: Record<string, unknown>) => Partial<S>;
  channels?: Partial<ChannelSchema<S>>;
}

// ----------------------------------------------------------------
// DebateConfig — config object for the debate template
// ----------------------------------------------------------------

export interface DebateConfig<S extends BaseSwarmState> {
  debaters: SwarmAgentDef<S>[];
  judge: {
    model: ONIModel;
    systemPrompt?: string;
    maxRounds: number;
    consensusKeyword?: string;
    /** Enable per-round scoring of debaters (scores stored in context.debateScores). */
    scoreDebaters?: boolean;
    /** Auto-consensus when score spread is within this threshold. */
    consensusThreshold?: number;
  };
  topic: keyof S;
  channels?: Partial<ChannelSchema<S>>;
}

// ----------------------------------------------------------------
// HierarchicalMeshConfig — config object for the hierarchical mesh template
// ----------------------------------------------------------------

export interface HierarchicalMeshConfig<S extends BaseSwarmState> {
  coordinator: {
    model: ONIModel;
    strategy: "llm" | "rule" | "round-robin";
    rules?: Array<{ condition: (task: string, context: Record<string, unknown>) => boolean; agentId: string }>;
    systemPrompt?: string;
    maxRounds?: number;
  };
  teams: Record<string, {
    topology: "pipeline" | "peerNetwork";
    agents: SwarmAgentDef<S>[];
    handoffs?: Record<string, (state: S) => string | typeof END>;
  }>;
  channels?: Partial<ChannelSchema<S>>;
}

// ----------------------------------------------------------------
// SwarmGraph
// ----------------------------------------------------------------

export class SwarmGraph<S extends BaseSwarmState> {
  private inner:    StateGraph<S>;
  private registry: AgentRegistry<S>;
  private channels: ChannelSchema<S>;
  private agentIds  = new Set<string>();
  private supervisorNodeName = "__supervisor__";
  private hasSupervisor = false;
  private onErrorPolicy: "fallback" | "throw" = "fallback";

  private _broker?: RequestReplyBroker;
  private _pubsub?: PubSub;

  private get broker(): RequestReplyBroker {
    return this._broker ??= new RequestReplyBroker();
  }

  private get pubsub(): PubSub {
    return this._pubsub ??= new PubSub();
  }

  constructor(channels?: Partial<ChannelSchema<S>>) {
    this.channels = {
      ...baseSwarmChannels,
      ...(channels ?? {}),
    } as ChannelSchema<S>;

    this.inner    = new StateGraph<S>({ channels: this.channels });
    this.registry = new AgentRegistry<S>();
  }

  // ---- Static factory: hierarchical template ----

  /**
   * Create a complete supervisor-workers swarm from a config object.
   * Registers all agents, wires a supervisor node, and returns the
   * ready-to-compile SwarmGraph.
   */
  static hierarchical<S extends BaseSwarmState>(
    config: HierarchicalConfig<S>,
  ): SwarmGraph<S> {
    const swarm = new SwarmGraph<S>(config.channels as Partial<ChannelSchema<S>>);

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

  // ---- Static factory: fan-out template ----

  /**
   * Create a fan-out swarm that runs all agents in parallel via Send
   * and collects results through a reducer node.
   */
  static fanOut<S extends BaseSwarmState>(
    config: FanOutConfig<S>,
  ): SwarmGraph<S> {
    const swarm = new SwarmGraph<S>(config.channels as Partial<ChannelSchema<S>>);
    const agentIds = config.agents.map((a) => a.id);
    const maxConcurrency = config.maxConcurrency;
    const timeoutMs = config.timeoutMs;
    const weights = config.weights;

    // Register agents in registry (but don't use addAgent — we wire manually)
    for (const agentDef of config.agents) {
      swarm.registry.register(agentDef as SwarmAgentDef<Record<string, unknown>> as any);
      swarm.agentIds.add(agentDef.id);
    }

    // Single orchestrator node that runs agents with concurrency/timeout control
    swarm.inner.addNode("__fanout_runner__", async (state: S, cfg?) => {
      const agentMap = new Map(config.agents.map((a) => [a.id, a]));

      async function runAgent(id: string): Promise<{ id: string; result: any; error: unknown | null }> {
        const agent = agentMap.get(id)!;
        try {
          await agent.hooks?.onStart?.(id, state as Record<string, unknown>);
          const result = await runWithTimeout(
            () => agent.skeleton.invoke(
              { ...state } as any,
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

      let allResults: Array<{ id: string; result: any; error: unknown | null }>;

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
      return { ...reduced, agentResults } as Partial<S>;
    });

    swarm.inner.addEdge(START, "__fanout_runner__");
    swarm.inner.addEdge("__fanout_runner__", END);

    return swarm;
  }

  // ---- Static factory: pipeline template ----

  /**
   * Create a linear agent pipeline: stage1 → stage2 → … → END.
   * Optionally override any stage's outgoing edge with a conditional
   * transition (e.g. loop back for review cycles).
   */
  static pipeline<S extends BaseSwarmState>(
    config: PipelineConfig<S>,
  ): SwarmGraph<S> {
    if (config.stages.length === 0) {
      throw new Error("SwarmGraph.pipeline: stages must contain at least one agent.");
    }
    const swarm = new SwarmGraph<S>(config.channels as Partial<ChannelSchema<S>>);
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

  // ---- Static factory: peer network template ----

  /**
   * Create a decentralized peer network: agents route to each other
   * via conditional handoffs, with no supervisor.
   */
  static peerNetwork<S extends BaseSwarmState>(
    config: PeerNetworkConfig<S>,
  ): SwarmGraph<S> {
    const swarm = new SwarmGraph<S>(config.channels as Partial<ChannelSchema<S>>);

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

  // ---- Static factory: map-reduce template ----

  /**
   * Distribute N inputs across poolSize copies of a mapper agent,
   * fan-out via Send, and collect results through a reducer node.
   */
  static mapReduce<S extends BaseSwarmState>(
    config: MapReduceConfig<S>,
  ): SwarmGraph<S> {
    const poolSize = config.poolSize ?? 1;
    if (poolSize < 1) {
      throw new Error("SwarmGraph.mapReduce: poolSize must be at least 1.");
    }
    const swarm = new SwarmGraph<S>(config.channels as Partial<ChannelSchema<S>>);

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
      return config.reducer((state as any).agentResults ?? {});
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
    }) as any);

    // Each mapper → __reducer__
    for (const id of mapperIds) {
      swarm.inner.addEdge(id, "__reducer__");
    }

    // __reducer__ → END
    swarm.inner.addEdge("__reducer__", END);

    return swarm;
  }

  // ---- Static factory: debate template ----

  /**
   * Create a multi-round parallel debate with judge termination.
   * All debaters argue in parallel each round; a judge evaluates
   * and decides whether consensus has been reached.
   */
  static debate<S extends BaseSwarmState>(
    config: DebateConfig<S>,
  ): SwarmGraph<S> {
    if (config.debaters.length === 0) {
      throw new Error("SwarmGraph.debate: debaters must contain at least one agent.");
    }
    const swarm = new SwarmGraph<S>(config.channels as Partial<ChannelSchema<S>>);
    const debaterIds = config.debaters.map((d) => d.id);
    const consensusKeyword = config.judge.consensusKeyword ?? "CONSENSUS";

    for (const debater of config.debaters) {
      swarm.addAgent(debater);
    }

    const scoreDebaters = config.judge.scoreDebaters ?? false;
    const consensusThreshold = config.judge.consensusThreshold;

    // Judge node: evaluates arguments, decides continue or consensus
    swarm.inner.addNode("__judge__", async (state: S) => {
      const round = (state as any).supervisorRound ?? 0;

      // If no agent results yet (first round), just kick off debaters
      const results = (state as any).agentResults ?? {};
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
      const isDone = isConsensus || nextRound > config.judge.maxRounds;

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
      if ((state as any).done) return END;
      return "__fanout__";
    });

    // __fanout__ → Send to all debaters in parallel
    swarm.inner.addConditionalEdges("__fanout__", ((state: S) =>
      debaterIds.map((id) => new Send(id, { ...state }))
    ) as any);

    // Each debater → __judge__
    for (const id of debaterIds) {
      swarm.inner.addEdge(id, "__judge__");
    }

    return swarm;
  }

  // ---- Static factory: hierarchical mesh template ----

  /**
   * Create a hierarchical mesh with a coordinator routing to team
   * sub-graphs. Each team is built using pipeline() or peerNetwork()
   * and compiled into a single node in the outer graph.
   */
  static hierarchicalMesh<S extends BaseSwarmState>(
    config: HierarchicalMeshConfig<S>,
  ): SwarmGraph<S> {
    const swarm = new SwarmGraph<S>(config.channels as Partial<ChannelSchema<S>>);
    const teamIds = Object.keys(config.teams);
    const maxRounds = config.coordinator.maxRounds ?? 10;

    // Build each team as a compiled sub-skeleton and mount as a node
    for (const [teamId, teamConfig] of Object.entries(config.teams)) {
      let teamSwarm: SwarmGraph<S>;

      if (teamConfig.topology === "pipeline") {
        teamSwarm = SwarmGraph.pipeline<S>({ stages: teamConfig.agents });
      } else {
        teamSwarm = SwarmGraph.peerNetwork<S>({
          agents: teamConfig.agents,
          entrypoint: teamConfig.agents[0]!.id,
          handoffs: teamConfig.handoffs ?? {},
        });
      }

      const teamSkeleton = teamSwarm.compile();

      // Mount team as a single node in the outer graph.
      // Spread all top-level fields from teamResult (including done, context)
      // so they propagate to the outer coordinator state.
      swarm.inner.addNode(teamId, async (state: S, cfg?) => {
        const teamResult = await teamSkeleton.invoke(state as any, cfg);
        return {
          ...(teamResult as object),
          agentResults: {
            ...((state as any).agentResults ?? {}),
            [teamId]: teamResult,
          },
        } as Partial<S>;
      });
    }

    // Coordinator node: routes to teams
    swarm.inner.addNode("__coordinator__", async (state: S) => {
      const round = (state as any).supervisorRound ?? 0;

      if (round >= maxRounds || (state as any).done) {
        return { done: true } as Partial<S>;
      }

      if (config.coordinator.strategy === "llm" && config.coordinator.model) {
        const teamList = teamIds.map((id) => `- ${id}`).join("\n");
        const response = await config.coordinator.model.chat({
          messages: [{
            role: "user",
            content: `Task: ${(state as any).task}\n\nAvailable teams:\n${teamList}\n\nRespond with the team name to route to, or "DONE" if complete.`,
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
        if ((state as any).done) return END;
        return "__coordinator__";
      });
    }

    // Coordinator → conditional (done → END, else handled by Command.goto)
    swarm.inner.addConditionalEdges("__coordinator__", (state: S) => {
      if ((state as any).done) return END;
      // Command.goto handles routing — this is the fallback
      return END;
    });

    return swarm;
  }

  // ---- Static factory: race template ----

  /**
   * Race all agents in parallel — first acceptable result wins.
   * Optionally filter results with an `accept` predicate.
   */
  static race<S extends BaseSwarmState>(
    config: {
      agents: SwarmAgentDef<S>[];
      accept?: (result: unknown) => boolean;
      timeoutMs?: number;
      channels?: Partial<ChannelSchema<S>>;
    },
  ): SwarmGraph<S> {
    const swarm = new SwarmGraph<S>(config.channels as Partial<ChannelSchema<S>>);
    const agentIds = config.agents.map((a) => a.id);
    const accept = config.accept ?? (() => true);
    const timeoutMs = config.timeoutMs;

    // Register agents so they appear in the registry
    for (const agentDef of config.agents) {
      swarm.registry.register(agentDef as SwarmAgentDef<Record<string, unknown>> as any);
      swarm.agentIds.add(agentDef.id);
    }

    // Single node that races all agents — resolves as soon as one produces
    // an acceptable result (true Promise.race semantics, not Promise.all).
    swarm.inner.addNode("__race__", async (state: S, cfg?) => {
      type RaceResult = { id: string; result: unknown; error: unknown | null };

      const agentPromises: Promise<RaceResult>[] = config.agents.map((agent) => {
        const p: Promise<RaceResult> = agent.skeleton
          .invoke({ ...state } as any, { ...cfg, agentId: agent.id })
          .then(
            (result) => ({ id: agent.id, result, error: null } as RaceResult),
            (err)    => ({ id: agent.id, result: null, error: err } as RaceResult),
          );

        if (timeoutMs != null) {
          return Promise.race([
            p,
            new Promise<RaceResult>((resolve) =>
              setTimeout(
                () => resolve({ id: agent.id, result: null, error: new Error("timeout") }),
                timeoutMs,
              ),
            ),
          ]);
        }
        return p;
      });

      // Resolve as soon as the first acceptable result arrives.
      const winner = await new Promise<RaceResult | null>((resolve) => {
        let remaining = agentPromises.length;
        if (remaining === 0) { resolve(null); return; }

        for (const p of agentPromises) {
          p.then((r) => {
            if (!r.error && accept(r.result)) {
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

  // ---- Static factory: dag template ----

  /**
   * Execute agents in dependency order (directed acyclic graph).
   * Agents with no dependencies run in parallel.
   */
  static dag<S extends BaseSwarmState>(
    config: {
      agents: SwarmAgentDef<S>[];
      dependencies: Record<string, string[]>;
      channels?: Partial<ChannelSchema<S>>;
    },
  ): SwarmGraph<S> {
    const agentMap = new Map(config.agents.map((a) => [a.id, a]));

    // Validate dependencies
    for (const [node, deps] of Object.entries(config.dependencies)) {
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

    // Build a standard swarm with wiring based on topological sort
    const swarm = new SwarmGraph<S>(config.channels as Partial<ChannelSchema<S>>);
    for (const agent of config.agents) {
      swarm.addAgent(agent);
    }

    // Group agents into layers based on dependencies
    const deps = config.dependencies;
    const rootIds = config.agents.filter((a) => !deps[a.id]?.length).map((a) => a.id);
    const nonRootIds = config.agents.filter((a) => deps[a.id]?.length).map((a) => a.id);

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

        // Execute ready nodes in parallel
        const batchResults = await Promise.all(
          ready.map(async (id) => {
            const agent = agentMap.get(id)!;
            const result = await agent.skeleton.invoke(
              { ...state, agentResults: { ...(state.agentResults ?? {}), ...results } } as any,
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
    // Remove any edges added by addAgent
    (swarm.inner as any).edges = [];
    swarm.inner.addEdge(START, "__dag_runner__");
    swarm.inner.addEdge("__dag_runner__", END);

    return swarm;
  }

  // ---- Static factory: pool template ----

  /**
   * Distribute N input items across poolSize copies of a single agent,
   * then reduce all results.
   */
  static pool<S extends BaseSwarmState>(
    config: {
      agent: SwarmAgentDef<S>;
      poolSize: number;
      inputField: keyof S;
      reducer: (results: Record<string, unknown>) => Partial<S>;
      channels?: Partial<ChannelSchema<S>>;
    },
  ): SwarmGraph<S> {
    const swarm = new SwarmGraph<S>(config.channels as Partial<ChannelSchema<S>>);
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

      await new Promise<void>((resolve, reject) => {
        let completed = 0;
        const total = queue.length;

        function processNext() {
          while (running < poolSize && queue.length > 0) {
            const work = queue.shift()!;

            // Respect removeAgent() — if the assigned slot was removed, redirect
            // to an active pool slot; if none remain, mark the item as failed.
            let agentDef = (swarm as any).registry.getDef(work.targetId) as SwarmAgentDef<S> | undefined;
            if (!agentDef) {
              const activeIds = poolIds.filter((id) => !!(swarm as any).registry.getDef(id));
              if (activeIds.length > 0) {
                work.targetId = activeIds[work.idx % activeIds.length]!;
                agentDef = (swarm as any).registry.getDef(work.targetId) as SwarmAgentDef<S>;
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
            const wrappedFn = (swarm.inner as any).nodes.get(work.targetId)?.fn as
              ((state: S, cfg?: ONIConfig) => Promise<NodeReturn<S>>) | undefined;
            const invocation = wrappedFn
              ? wrappedFn({ ...state, task: String(work.item) } as S, { ...cfg, agentId: work.targetId })
              : agentDef.skeleton.invoke(
                  { ...state, task: String(work.item) } as any,
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
    (swarm.inner as any).edges = [];
    swarm.inner.addEdge(START, "__pool_runner__");
    swarm.inner.addEdge("__pool_runner__", END);

    return swarm;
  }

  // ---- Static factory: compose template ----

  /**
   * Compose multiple sub-swarms as pipeline stages.
   * Each stage runs a compiled sub-swarm, passing state through.
   */
  static compose<S extends BaseSwarmState>(
    config: { stages: Array<{ id: string; swarm: SwarmGraph<S> }>; channels?: Partial<ChannelSchema<S>> },
  ): SwarmGraph<S> {
    if (config.stages.length === 0) {
      throw new Error("SwarmGraph.compose: stages must contain at least one sub-swarm.");
    }
    const swarm = new SwarmGraph<S>(config.channels as Partial<ChannelSchema<S>>);
    const stageIds = config.stages.map((s) => s.id);

    for (const stage of config.stages) {
      const compiled = stage.swarm.compile();
      swarm.inner.addNode(stage.id, async (state: S, cfg?) => {
        const stageResult = await compiled.invoke(state as any, cfg);
        return {
          ...stageResult,
          agentResults: {
            ...((state as any).agentResults ?? {}),
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

  // ---- Agent registration ----

  addAgent(def: SwarmAgentDef<S>): this {
    this.registry.register(def);
    this.agentIds.add(def.id);

    // Wrap the agent's skeleton as a node
    // The node executes the agent's skeleton and handles Handoff returns
    const agentNode: NodeFn<S> = async (state: S, config?: ONIConfig) => {
      this.registry.markBusy(def.id);

      // Fire onStart hook
      await def.hooks?.onStart?.(def.id, state as Record<string, unknown>);

      const maxRetries = def.maxRetries ?? 2;
      const retryDelayMs = def.retryDelayMs ?? 0;
      let lastError: unknown;
      let lastAttempt = 0;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        lastAttempt = attempt;
        try {
          // Get inbox and filter out already-consumed messages
          const consumedIds = ((state.context as Record<string, unknown>)?.__consumedMsgIds ?? []) as string[];
          const consumedSet = new Set(consumedIds);
          const allInbox = getInbox(state.swarmMessages ?? [], def.id);
          const inbox = allInbox.filter((m) => !consumedSet.has(m.id));

          // Track consumed message IDs
          const newConsumedIds = [...consumedIds, ...inbox.map((m) => m.id)];

          const agentInput: Partial<S> = {
            ...state,
            context: {
              ...(state.context ?? {}),
              inbox,
              __consumedMsgIds: newConsumedIds,
            },
          } as Partial<S>;

          let effectiveTimeout = def.timeout;

          // Clamp agent timeout to remaining deadline (if set)
          const deadlineAbs = (state.context as Record<string, unknown>)?.__deadlineAbsolute as number | undefined;
          if (deadlineAbs != null) {
            const remaining = deadlineAbs - Date.now();
            if (remaining <= 0) {
              throw new Error(`Agent "${def.id}" deadline expired`);
            }
            if (effectiveTimeout == null || remaining < effectiveTimeout) {
              effectiveTimeout = remaining;
            }
          }

          const result = await runWithTimeout(
            () => def.skeleton.invoke(agentInput, {
              ...config,
              agentId: def.id,
            }),
            effectiveTimeout,
            () => new Error(`Agent "${def.id}" timed out after ${effectiveTimeout}ms`),
          );

          this.registry.markIdle(def.id);

          // ---- Handoff detection ----
          if (result instanceof Handoff || (result && (result as any).isHandoff)) {
            const handoff = result instanceof Handoff
              ? result
              : new Handoff((result as any).opts);
            // Fire onComplete for handoffs too
            await def.hooks?.onComplete?.(def.id, result);
            return new Command<S>({
              update: {
                context: { ...(state.context ?? {}), ...(handoff.context ?? {}) },
                handoffHistory: [{
                  from:      def.id,
                  to:        handoff.to,
                  message:   handoff.message,
                  step:      state.supervisorRound ?? 0,
                  timestamp: Date.now(),
                  resume:    handoff.resume,
                }],
                currentAgent: handoff.to,
              } as Partial<S>,
              goto: handoff.to,
            });
          }

          // Fire onComplete hook
          await def.hooks?.onComplete?.(def.id, result);

          // ---- Normal result ----
          return {
            ...result,
            context: {
              ...((result as any).context ?? {}),
              __consumedMsgIds: newConsumedIds,
            },
            agentResults: {
              ...(state.agentResults ?? {}),
              [def.id]: result,
            },
            handoffHistory: [
              ...(state.handoffHistory ?? []),
              {
                from:      def.id,
                to:        "__completed__",
                message:   "Agent completed",
                step:      state.supervisorRound ?? 0,
                timestamp: Date.now(),
              },
            ],
          } as Partial<S>;
        } catch (err) {
          lastError = err;
          this.registry.markError(def.id);
          if (attempt < maxRetries) {
            // Backoff delay between retries — clamped to remaining deadline
            if (retryDelayMs > 0) {
              let delay = retryDelayMs;
              const dl = (state.context as Record<string, unknown>)?.__deadlineAbsolute as number | undefined;
              if (dl != null) {
                const remaining = dl - Date.now();
                if (remaining <= 0) break; // deadline expired, stop retrying
                delay = Math.min(delay, remaining);
              }
              await new Promise((r) => setTimeout(r, delay));
            }
            continue; // retry
          }
        }
      }

      // All retries exhausted — fire onError hook
      await def.hooks?.onError?.(def.id, lastError);

      // Keep agent in error status (don't reset to idle)

      // Build structured error context
      const errStr = String(lastError instanceof Error ? lastError.message : lastError);
      const errType: "model_error" | "tool_error" | "timeout" | "unknown" =
        errStr.includes("timeout") ? "timeout" :
        errStr.includes("model") ? "model_error" :
        errStr.includes("tool") ? "tool_error" :
        "unknown";

      if (this.hasSupervisor && this.onErrorPolicy !== "throw") {
        return new Command<S>({
          update: {
            context: {
              ...(state.context ?? {}),
              lastAgentError: {
                agent: def.id,
                error: errStr,
                type: errType,
                attempt: lastAttempt,
                maxRetries,
              },
            },
          } as unknown as Partial<S>,
          goto: this.supervisorNodeName,
        });
      }

      // No supervisor, or onError: "throw" — rethrow
      throw lastError;
    };

    this.inner.addNode(def.id, agentNode);
    return this;
  }

  // ---- Supervisor ----

  addSupervisor(config: SupervisorConfig<S>, nodeName = this.supervisorNodeName): this {
    this.supervisorNodeName = nodeName;
    this.hasSupervisor = true;

    const supervisorFn = createSupervisorNode<S & SupervisorState>(
      this.registry as unknown as AgentRegistry<S & SupervisorState>,
      config as SupervisorConfig<S & SupervisorState>
    ) as NodeFn<S>;

    this.inner.addNode(nodeName, supervisorFn);

    // Wire: START → Supervisor
    this.inner.addEdge(START, nodeName);

    // Wire: each agent → Supervisor (return path)
    for (const agentId of this.agentIds) {
      this.inner.addConditionalEdges(agentId, (state: S) => {
        // If agent marked done, go to END
        if (state.done) return END;
        return nodeName;
      });
    }

    return this;
  }

  // ---- Peer-to-peer handoff edges ----

  /**
   * Wire two agents to hand off directly to each other.
   * The "from" agent's node will inspect its output for a Handoff
   * and route accordingly.
   */
  addHandoffEdge(fromAgentId: string, toAgentId: string): this {
    this.inner.addEdge(fromAgentId, toAgentId);
    return this;
  }

  /**
   * Add a conditional handoff: fromAgent routes to different agents
   * based on state.
   */
  addConditionalHandoff(
    fromAgentId: string,
    condition:   (state: S) => string | typeof END
  ): this {
    this.inner.addConditionalEdges(fromAgentId, condition);
    return this;
  }

  // ---- Static edge passthrough ----

  addEdge(from: string, to: string): this {
    this.inner.addEdge(from, to);
    return this;
  }

  // ---- Topology validation ----

  /**
   * Check the swarm topology for common issues like orphan agents.
   * Returns an array of issue strings (empty = valid).
   */
  validateTopology(): string[] {
    const issues: string[] = [];

    // In supervised swarms, all agents are reachable via Command.goto
    if (this.hasSupervisor) return issues;

    // For non-supervised swarms, check that every agent has at least one incoming edge
    const edgeTargets = new Set<string>();
    for (const edge of (this.inner as any).edges) {
      if (edge.type === "static") {
        edgeTargets.add(edge.to as string);
      }
      // Conditional edges also declare a reachable target
      if (edge.type === "conditional" && edge.pathMap) {
        for (const target of Object.values(edge.pathMap as Record<string, string>)) {
          edgeTargets.add(target);
        }
      }
    }

    for (const agentId of this.agentIds) {
      if (!edgeTargets.has(agentId)) {
        issues.push(`Agent "${agentId}" is an orphan — no edges connect to or from it.`);
      }
    }

    return issues;
  }

  // ---- Pipeline shorthand ----

  /**
   * Wire agents as a linear pipeline: A → B → C → END
   */
  pipeline(...agentIds: string[]): this {
    if (agentIds.length < 1) return this;
    this.inner.addEdge(START, agentIds[0]!);
    for (let i = 0; i < agentIds.length - 1; i++) {
      this.inner.addEdge(agentIds[i]!, agentIds[i + 1]!);
    }
    this.inner.addEdge(agentIds[agentIds.length - 1]!, END);
    return this;
  }

  // ---- Compile ----

  compile(opts: SwarmCompileOpts<S> = {}): ONISkeleton<S> & SwarmExtensions<S> {
    const skeleton = this.inner.compile({
      ...(opts.checkpointer    ? { checkpointer:    opts.checkpointer }    : {}),
      ...(opts.interruptBefore ? { interruptBefore: opts.interruptBefore } : {}),
      ...(opts.interruptAfter  ? { interruptAfter:  opts.interruptAfter }  : {}),
    } as any);

    const registry = this.registry;
    const inner = this.inner;
    const hasSupervisor = this.hasSupervisor;
    const supervisorNodeName = this.supervisorNodeName;
    const self = this;

    // Attach swarm-specific extensions
    const extensions: SwarmExtensions<S> = {
      registry,
      agentStats: () => registry.stats(),
      toMermaid:  () => inner.toMermaid(),

      spawnAgent(def: SwarmAgentDef<S>) {
        // Register in the registry
        registry.register(def as SwarmAgentDef<Record<string, unknown>> as any);

        // Create the agent node function (same logic as addAgent)
        const agentNode: NodeFn<S> = async (state: S, config?: ONIConfig) => {
          registry.markBusy(def.id);
          await def.hooks?.onStart?.(def.id, state as Record<string, unknown>);

          const maxRetries = def.maxRetries ?? 2;
          let lastError: unknown;

          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
              const result = await def.skeleton.invoke(
                { ...state, context: { ...(state.context ?? {}), inbox: getInbox(state.swarmMessages ?? [], def.id) } } as any,
                { ...config, agentId: def.id },
              );
              registry.markIdle(def.id);
              await def.hooks?.onComplete?.(def.id, result);
              return {
                ...result,
                agentResults: { ...(state.agentResults ?? {}), [def.id]: result },
              } as Partial<S>;
            } catch (err) {
              lastError = err;
              registry.markError(def.id);
              if (attempt < maxRetries) continue;
            }
          }

          await def.hooks?.onError?.(def.id, lastError);
          // Keep agent in error status (don't reset to idle)

          if (hasSupervisor) {
            return new Command<S>({
              update: { context: { ...(state.context ?? {}), lastAgentError: { agent: def.id, error: String(lastError) } } } as unknown as Partial<S>,
              goto: supervisorNodeName,
            });
          }
          throw lastError;
        };

        // Add node to the compiled runner's nodes map
        const runner = (skeleton as any)._runner;
        if (runner?.nodes) {
          runner.nodes.set(def.id, { name: def.id, fn: agentNode });
        }

        // In supervised swarms, add a conditional return edge so the runner
        // knows to send this agent's output back to the supervisor (or END).
        if (hasSupervisor && runner) {
          const returnEdge = {
            type: "conditional" as const,
            from: def.id,
            condition: (st: S) => (st as Record<string, unknown>).done ? END : supervisorNodeName,
          };
          const edgesBySource = (runner as any)._edgesBySource as Map<string, unknown[]>;
          const list = edgesBySource.get(def.id) ?? [];
          list.push(returnEdge);
          edgesBySource.set(def.id, list);
        }
      },

      removeAgent(agentId: string) {
        registry.deregister(agentId);
        (skeleton as any)._runner?.nodes?.delete(agentId);
      },
    };

    return Object.assign(skeleton, extensions);
  }
}

export interface SwarmCompileOpts<S> {
  checkpointer?:    ONICheckpointer<S>;
  interruptBefore?: string[];
  interruptAfter?:  string[];
}

export interface SwarmExtensions<S extends Record<string, unknown>> {
  registry:   AgentRegistry<S>;
  agentStats: () => ReturnType<AgentRegistry<S>["stats"]>;
  toMermaid:  () => string;
  /** Dynamically spawn a new agent into the compiled swarm */
  spawnAgent: (def: SwarmAgentDef<S>) => void;
  /** Remove an agent from the compiled swarm (marks as terminated) */
  removeAgent: (agentId: string) => void;
}

// ----------------------------------------------------------------
// quickAgent — convenience factory for tests and simple swarms
// ----------------------------------------------------------------

/**
 * Create a SwarmAgentDef from just an id and a handler function.
 * Builds a single-node StateGraph internally so the agent is fully
 * functional in any SwarmGraph topology.
 */
export function quickAgent(
  id: string,
  fn: (state: BaseSwarmState) => Promise<Partial<BaseSwarmState>> | Partial<BaseSwarmState>,
  opts?: {
    role?: string;
    capabilities?: AgentCapability[];
    hooks?: SwarmAgentDef["hooks"];
    maxRetries?: number;
    maxConcurrency?: number;
    systemPrompt?: string;
    timeout?: number;
    retryDelayMs?: number;
  },
): SwarmAgentDef<BaseSwarmState> {
  const g = new StateGraph<BaseSwarmState>({ channels: baseSwarmChannels as ChannelSchema<BaseSwarmState> });
  g.addNode("work", async (state: BaseSwarmState) => fn(state));
  g.addEdge(START, "work");
  g.addEdge("work", END);
  const skeleton = g.compile();

  return {
    id,
    role: opts?.role ?? id,
    capabilities: opts?.capabilities ?? [],
    skeleton: skeleton as ONISkeleton<BaseSwarmState>,
    hooks: opts?.hooks,
    maxRetries: opts?.maxRetries,
    maxConcurrency: opts?.maxConcurrency,
    systemPrompt: opts?.systemPrompt,
    timeout: opts?.timeout,
    retryDelayMs: opts?.retryDelayMs,
  };
}
