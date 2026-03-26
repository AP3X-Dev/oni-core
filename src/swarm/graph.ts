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
import type { ONISkeletonV3 } from "../graph.js";
import { START, END, lastValue } from "../types.js";
import type {
  NodeFn, ONISkeleton, ChannelSchema,
} from "../types.js";
import type {
  SwarmAgentDef, SupervisorConfig,
  AgentCapability,
} from "./types.js";
import { AgentRegistry } from "./registry.js";
import { baseSwarmChannels } from "./config.js";
import type {
  BaseSwarmState,
  HierarchicalConfig, FanOutConfig, PipelineConfig, PeerNetworkConfig,
  MapReduceConfig, DebateConfig, HierarchicalMeshConfig,
  SwarmCompileOpts, SwarmExtensions,
} from "./config.js";
import { createSupervisorNode, type SupervisorState } from "./supervisor.js";
import { RequestReplyBroker } from "../coordination/request-reply.js";
import { PubSub } from "../coordination/pubsub.js";
import { createAgentNode } from "./agent-node.js";
import { buildSwarmExtensions } from "./compile-ext.js";
import {
  buildHierarchical, buildFanOut, buildPipeline, buildPeerNetwork,
  buildMapReduce, buildDebate, buildHierarchicalMesh, buildRace,
  buildDag, buildPool, buildCompose,
} from "./factories.js";

// ----------------------------------------------------------------
// SwarmGraph
// ----------------------------------------------------------------

export class SwarmGraph<S extends BaseSwarmState> {
  /** @internal */ inner:    StateGraph<S>;
  /** @internal */ registry: AgentRegistry<S>;
  /** @internal */ channels: ChannelSchema<S>;
  /** @internal */ agentIds  = new Set<string>();
  /** @internal */ supervisorNodeName = "__supervisor__";
  /** @internal */ hasSupervisor = false;
  /** @internal */ onErrorPolicy: "fallback" | "throw" = "fallback";

  private _broker?: RequestReplyBroker;
  private _pubsub?: PubSub;
  private subGraphs: SwarmGraph<S>[] = [];

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
    return buildHierarchical(config, new SwarmGraph<S>(config.channels as Partial<ChannelSchema<S>>));
  }

  // ---- Static factory: fan-out template ----

  /**
   * Create a fan-out swarm that runs all agents in parallel via Send
   * and collects results through a reducer node.
   */
  static fanOut<S extends BaseSwarmState>(
    config: FanOutConfig<S>,
  ): SwarmGraph<S> {
    return buildFanOut(config, new SwarmGraph<S>(config.channels as Partial<ChannelSchema<S>>));
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
    return buildPipeline(config, new SwarmGraph<S>(config.channels as Partial<ChannelSchema<S>>));
  }

  // ---- Static factory: peer network template ----

  /**
   * Create a decentralized peer network: agents route to each other
   * via conditional handoffs, with no supervisor.
   */
  static peerNetwork<S extends BaseSwarmState>(
    config: PeerNetworkConfig<S>,
  ): SwarmGraph<S> {
    return buildPeerNetwork(config, new SwarmGraph<S>(config.channels as Partial<ChannelSchema<S>>));
  }

  // ---- Static factory: map-reduce template ----

  /**
   * Distribute N inputs across poolSize copies of a mapper agent,
   * fan-out via Send, and collect results through a reducer node.
   */
  static mapReduce<S extends BaseSwarmState>(
    config: MapReduceConfig<S>,
  ): SwarmGraph<S> {
    return buildMapReduce(config, new SwarmGraph<S>(config.channels as Partial<ChannelSchema<S>>));
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
    return buildDebate(config, new SwarmGraph<S>(config.channels as Partial<ChannelSchema<S>>));
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
    const parent = new SwarmGraph<S>(config.channels as Partial<ChannelSchema<S>>);
    return buildHierarchicalMesh(
      config,
      parent,
      (ch) => {
        const sub = new SwarmGraph<S>(ch);
        parent.subGraphs.push(sub);
        return sub;
      },
    );
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
    return buildRace(config, new SwarmGraph<S>(config.channels as Partial<ChannelSchema<S>>));
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
    return buildDag(config, new SwarmGraph<S>(config.channels as Partial<ChannelSchema<S>>));
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
    return buildPool(config, new SwarmGraph<S>(config.channels as Partial<ChannelSchema<S>>));
  }

  // ---- Static factory: compose template ----

  /**
   * Compose multiple sub-swarms as pipeline stages.
   * Each stage runs a compiled sub-swarm, passing state through.
   */
  static compose<S extends BaseSwarmState>(
    config: { stages: Array<{ id: string; swarm: SwarmGraph<S> }>; channels?: Partial<ChannelSchema<S>> },
  ): SwarmGraph<S> {
    const parent = new SwarmGraph<S>(config.channels as Partial<ChannelSchema<S>>);
    for (const stage of config.stages) {
      parent.subGraphs.push(stage.swarm);
    }
    return buildCompose(config, parent);
  }

  // ---- Agent registration ----

  addAgent(def: SwarmAgentDef<S>): this {
    this.registry.register(def);
    this.agentIds.add(def.id);
    this.inner.addNode(def.id, createAgentNode(def, this.registry, this));
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const edge of (this.inner as any).edges) { // SAFE: external boundary — accessing private StateGraph.edges for topology validation
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

  // ---- Static factory: GAN loop template ----

  /**
   * Create a generator/evaluator loop (GAN-inspired).
   * Generator produces output → evaluator scores it → loop decides
   * refine, pivot, or accept. Returns a StateGraph that can be compiled.
   */
  static ganLoop<TState extends Record<string, unknown> = Record<string, unknown>>(
    config: GANLoopConfig<TState>,
  ): StateGraph<GANState<TState>> {
    const maxIterations = config.maxIterations ?? 10;
    const passingThreshold = config.passingThreshold ?? 0.80;
    const pivotThreshold = config.pivotThreshold ?? 0.40;

    // Validate criteria weights sum to 1.0 (within floating-point tolerance)
    const weightSum = config.criteria.reduce((sum, c) => sum + c.weight, 0);
    if (Math.abs(weightSum - 1.0) > 0.001) {
      throw new Error(
        `GAN loop criteria weights must sum to 1.0, got ${weightSum.toFixed(4)}`
      );
    }

    // Define channels
    const channels = {
      iteration:          lastValue(() => 0),
      decision:           lastValue((): "refine" | "pivot" | "accept" => "refine"),
      done:               lastValue(() => false),
      generatorOutput:    lastValue((): TState => ({} as TState)),
      scores:             lastValue((): CriterionScore[] => []),
      compositeScore:     lastValue(() => 0),
      evaluatorFeedback:  lastValue(() => ""),
      criteria:           lastValue((): EvaluationCriterion[] => config.criteria),
      bestIteration:      lastValue((): GANIterationResult<TState> | null => null),
      bestCompositeScore: lastValue(() => 0),
      maxIterations:      lastValue(() => maxIterations),
      passingThreshold:   lastValue(() => passingThreshold),
      pivotThreshold:     lastValue(() => pivotThreshold),
    } as ChannelSchema<GANState<TState>>;

    const graph = new StateGraph<GANState<TState>>({ channels });

    // ── Generator node ──
    graph.addNode("__gan_generator__", async (state) => {
      const result = await config.generator.fn(state);
      return {
        ...(result as Partial<GANState<TState>>),
        iteration: state.iteration + 1,
      } as Partial<GANState<TState>>;
    });

    // ── Evaluator node ──
    graph.addNode("__gan_evaluator__", async (state) => {
      // Run the evaluator function
      const evalResult = await config.evaluator.fn(state);
      const updates = (evalResult ?? {}) as Partial<GANState<TState>>;

      // Extract scores from evaluator output
      const scores: CriterionScore[] = updates.scores ?? state.scores;
      const feedback: string = updates.evaluatorFeedback ?? state.evaluatorFeedback;

      // Compute composite score
      let compositeScore = 0;
      for (const score of scores) {
        const criterion = config.criteria.find(c => c.id === score.criterionId);
        if (criterion) compositeScore += criterion.weight * score.score;
      }

      // Check hard thresholds
      let hardFail = false;
      for (const score of scores) {
        const criterion = config.criteria.find(c => c.id === score.criterionId);
        if (criterion?.hardThreshold !== undefined && score.score < criterion.hardThreshold) {
          hardFail = true;
          break;
        }
      }

      // Determine decision
      let decision: "refine" | "pivot" | "accept";
      if (!hardFail && compositeScore >= passingThreshold) {
        decision = "accept";
      } else if (compositeScore < pivotThreshold) {
        decision = "pivot";
      } else {
        decision = "refine";
      }

      // Build iteration result
      const iterResult: GANIterationResult<TState> = {
        iteration: state.iteration,
        generatorOutput: state.generatorOutput,
        scores,
        compositeScore,
        decision,
        evaluatorFeedback: feedback,
      };

      // Track best iteration
      let bestIteration = state.bestIteration;
      let bestCompositeScore = state.bestCompositeScore;
      if (compositeScore > bestCompositeScore) {
        bestIteration = iterResult;
        bestCompositeScore = compositeScore;
      }

      // Check termination conditions
      let done = decision === "accept";
      if (state.iteration >= maxIterations) done = true;

      // Call onIteration callback if provided
      if (config.onIteration && !done) {
        const shouldContinue = await config.onIteration(state.iteration, scores, decision);
        if (!shouldContinue) done = true;
      }

      return {
        ...updates,
        scores,
        compositeScore,
        evaluatorFeedback: feedback,
        decision,
        done,
        bestIteration,
        bestCompositeScore,
      } as Partial<GANState<TState>>;
    });

    // ── Edges ──
    graph.addEdge(START, "__gan_generator__");
    graph.addEdge("__gan_generator__", "__gan_evaluator__");
    graph.addConditionalEdges("__gan_evaluator__", (state: GANState<TState>) => {
      if (state.done) return END;
      return "__gan_generator__";
    });

    return graph;
  }

  // ---- Dispose ----

  /**
   * Dispose the swarm graph, cleaning up broker timeouts, pubsub
   * subscribers, and any tracked sub-graphs created by
   * hierarchicalMesh() or compose().
   */
  dispose(): void {
    for (const sub of this.subGraphs) {
      sub.dispose();
    }
    this.subGraphs.length = 0;
    this._broker?.dispose();
    this._pubsub?.dispose();
    this._broker = undefined;
    this._pubsub = undefined;
  }

  // ---- Compile ----

  compile(opts: SwarmCompileOpts<S> = {}): ONISkeletonV3<S> & SwarmExtensions<S> {
    const skeleton = this.inner.compile({
      ...(opts.checkpointer    !== undefined ? { checkpointer:    opts.checkpointer }    : {}),
      ...(opts.interruptBefore !== undefined ? { interruptBefore: opts.interruptBefore } : {}),
      ...(opts.interruptAfter  !== undefined ? { interruptAfter:  opts.interruptAfter }  : {}),
      ...(opts.store           !== undefined ? { store:           opts.store }           : {}),
      ...(opts.guardrails      !== undefined ? { guardrails:      opts.guardrails }      : {}),
      ...(opts.listeners       !== undefined ? { listeners:       opts.listeners }       : {}),
      ...(opts.defaults        !== undefined ? { defaults:        opts.defaults }        : {}),
      ...(opts.deadLetterQueue !== undefined ? { deadLetterQueue: opts.deadLetterQueue } : {}),
      ...(opts.tracer          !== undefined ? { tracer:          opts.tracer }          : {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any); // SAFE: CompileOptions conditional spread — TypeScript can't narrow the intersection type

    const extensions = buildSwarmExtensions(
      skeleton,
      this.registry,
      this.inner,
      this.hasSupervisor,
      this.supervisorNodeName,
      this.onErrorPolicy,
    );

    return Object.assign(skeleton, extensions);
  }
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

// ----------------------------------------------------------------
// Re-exports from config.ts — keeps existing imports from "./graph.js" working
// ----------------------------------------------------------------

export type { BaseSwarmState, SwarmCompileOpts, SwarmExtensions, PregelRunnerInternals } from "./config.js";
export { baseSwarmChannels } from "./config.js";
export type {
  HierarchicalConfig, FanOutConfig, PipelineConfig, PeerNetworkConfig,
  MapReduceConfig, DebateConfig, HierarchicalMeshConfig,
} from "./config.js";

// ----------------------------------------------------------------
// GAN Loop Types
// ----------------------------------------------------------------

export interface AgentDefinition<TState> {
  /** Agent identifier, used as node name prefix */
  id: string;
  /** The agent's execution function */
  fn: (state: GANState<TState>) => Promise<Partial<GANState<TState>>> | Partial<GANState<TState>>;
}

export interface EvaluationCriterion {
  id: string;
  name: string;
  description: string;
  /** Weight 0-1, all weights must sum to 1.0 */
  weight: number;
  /** If set, failing this criterion fails the entire evaluation */
  hardThreshold?: number;
}

export interface CriterionScore {
  criterionId: string;
  score: number;
  rationale: string;
  passed: boolean;
}

export interface GANIterationResult<TState> {
  iteration: number;
  generatorOutput: TState;
  scores: CriterionScore[];
  compositeScore: number;
  decision: "refine" | "pivot" | "accept";
  evaluatorFeedback: string;
}

export interface GANLoopConfig<TState> {
  /** The agent that produces output */
  generator: AgentDefinition<TState>;
  /** The agent that evaluates and critiques output */
  evaluator: AgentDefinition<TState>;
  /** Scoring criteria passed to both agents */
  criteria: EvaluationCriterion[];
  /** Max iterations before forced termination. Default: 10 */
  maxIterations?: number;
  /** Composite score threshold for acceptance. Default: 0.80 */
  passingThreshold?: number;
  /** Called after each evaluation — return true to continue, false to stop */
  onIteration?: (iteration: number, scores: CriterionScore[], decision: "refine" | "pivot" | "accept") => Promise<boolean>;
  /** Score below this triggers a pivot (full approach change). Default: 0.40 */
  pivotThreshold?: number;
}

export type GANState<TState = Record<string, unknown>> = {
  iteration: number;
  decision: "refine" | "pivot" | "accept";
  done: boolean;
  generatorOutput: TState;
  scores: CriterionScore[];
  compositeScore: number;
  evaluatorFeedback: string;
  criteria: EvaluationCriterion[];
  bestIteration: GANIterationResult<TState> | null;
  bestCompositeScore: number;
  maxIterations: number;
  passingThreshold: number;
  pivotThreshold: number;
  [key: string]: unknown;
};
