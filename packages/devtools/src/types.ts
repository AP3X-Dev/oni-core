// ============================================================
// @oni.bot/devtools — Types
// ============================================================

/**
 * Mirrors the graph descriptor shape from @oni.bot/core/inspect
 * to avoid build-time dependency on core internals.
 */
export interface GraphNode {
  id: string;
  type: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: "static" | "conditional";
  label?: string;
}

export interface GraphDescriptor {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Mirrors the DynamicToolRegistry interface — only methods we need.
 */
export interface ToolRegistryLike {
  list(): string[];
  asSchema(): Array<{
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }>;
}

/**
 * A compiled graph that exposes getGraph() for topology inspection.
 */
export interface CompiledGraphLike {
  getGraph(): GraphDescriptor;
}

export interface RunRecord {
  run_id: string;
  started_at: number;
  ended_at?: number;
  events: NodeEvent[];
}

export interface NodeEvent {
  type: "node_start" | "node_end";
  run_id: string;
  node: string;
  ts: number;
  duration_ms?: number;
  state_keys_changed?: string[];
}

export interface DevtoolsOptions {
  /** The compiled ONI graph */
  graph: CompiledGraphLike;
  /** The tool registry */
  registry: ToolRegistryLike;
  /** HTTP port. Default 7823 */
  port?: number;
  /** How many runs to keep in memory. Default 50 */
  maxRuns?: number;
}

export interface DevtoolsServer {
  /** Stop the HTTP server */
  stop: () => Promise<void>;
  /** The URL the server is listening on */
  url: string;
  /** Emit a node lifecycle event (called by graph instrumentation) */
  emit: (event: NodeEvent) => void;
  /** Emit a tool registration event */
  emitToolRegistered: (name: string, source?: string) => void;
  /** Emit a tool unregistration event */
  emitToolUnregistered: (name: string) => void;
}
