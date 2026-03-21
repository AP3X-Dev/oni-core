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
import { START, END } from "../types.js";
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
    return buildHierarchicalMesh(
      config,
      new SwarmGraph<S>(config.channels as Partial<ChannelSchema<S>>),
      (ch) => new SwarmGraph<S>(ch),
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
    return buildCompose(config, new SwarmGraph<S>(config.channels as Partial<ChannelSchema<S>>));
  }

  // ---- Disposal ----

  /**
   * Dispose of the broker and pubsub instances to release timer handles
   * and subscriber maps. Call when the SwarmGraph is no longer needed.
   */
  dispose(): void {
    this._broker?.dispose();
    this._pubsub?.dispose();
    this._broker = undefined;
    this._pubsub = undefined;
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
