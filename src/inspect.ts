// ============================================================
// @oni.bot/core — Graph Inspection API
// ============================================================
// Returns a structured object describing the graph topology.
// Used by: visualizers, AgentOS ADE, debuggers, validators.
// ============================================================

import { START, END } from "./types.js";
import type { Edge } from "./types.js";

// ----------------------------------------------------------------
// Graph descriptor types
// ----------------------------------------------------------------

export type NodeType = "start" | "end" | "node" | "subgraph";

export interface GraphNode {
  id:       string;
  type:     NodeType;
  hasRetry: boolean;
  isSubgraph: boolean;
}

export interface GraphEdge {
  from:        string;
  to:          string;
  type:        "static" | "conditional";
  label?:      string;
}

export interface GraphDescriptor {
  nodes:     GraphNode[];
  edges:     GraphEdge[];
  /** Nodes that have no outgoing edges to non-END nodes */
  terminals: string[];
  /** Nodes that can reach themselves (cycles) */
  cycles:    string[][];
  /** Topologically sorted node order (if acyclic) */
  topoOrder: string[] | null;
}

// ----------------------------------------------------------------
// buildGraphDescriptor — called by StateGraph.getGraph()
// ----------------------------------------------------------------

export function buildGraphDescriptor<S>(
  nodeMap: Map<string, { name: string; retry?: unknown; subgraph?: unknown }>,
  edges:   Edge<S>[]
): GraphDescriptor {
  // Build node list
  const nodes: GraphNode[] = [
    { id: START, type: "start", hasRetry: false, isSubgraph: false },
    { id: END,   type: "end",   hasRetry: false, isSubgraph: false },
  ];

  for (const [id, def] of nodeMap) {
    nodes.push({
      id,
      type:       def.subgraph ? "subgraph" : "node",
      hasRetry:   !!def.retry,
      isSubgraph: !!def.subgraph,
    });
  }

  // Build edge list — expand conditional edges that have a pathMap into
  // individual edges per possible destination so cycle detection can traverse them.
  const graphEdges: GraphEdge[] = [];
  for (const e of edges) {
    if (e.type === "static") {
      graphEdges.push({ from: e.from as string, to: e.to as string, type: "static" });
    } else {
      const pathMap = (e as { pathMap?: Record<string, string> }).pathMap;
      if (pathMap && Object.keys(pathMap).length > 0) {
        for (const target of Object.values(pathMap)) {
          graphEdges.push({ from: e.from as string, to: target, type: "conditional", label: "condition" });
        }
      } else {
        // No pathMap — single placeholder; cycle detection treats this conservatively
        graphEdges.push({ from: e.from as string, to: "conditional", type: "conditional", label: "condition" });
      }
    }
  }

  // Find terminal nodes
  const nodeIds = new Set(nodes.map((n) => n.id));
  const hasOutgoing = new Set(edges.map((e) => e.from as string));
  const terminals = nodes
    .filter((n) => n.id !== START && n.id !== END && !hasOutgoing.has(n.id))
    .map((n) => n.id);

  // Detect cycles (DFS)
  const cycles = detectCycles(nodeIds, graphEdges);

  // Topological sort (Kahn's algorithm, returns null if cyclic)
  const topoOrder = cycles.length === 0 ? topoSort(nodeIds, graphEdges) : null;

  return { nodes, edges: graphEdges, terminals, cycles, topoOrder };
}

// ----------------------------------------------------------------
// Cycle detection — DFS
// ----------------------------------------------------------------

function detectCycles(
  nodes: Set<string>,
  edges: GraphEdge[]
): string[][] {
  const adj = new Map<string, string[]>();
  for (const id of nodes) adj.set(id, []);
  for (const e of edges) {
    if (e.to === "conditional") {
      // Unknown routing (no pathMap) — conservatively add edges to all nodes
      // to prevent false-negative cycle detection.
      for (const target of nodes) adj.get(e.from)?.push(target);
    } else {
      adj.get(e.from)?.push(e.to);
    }
  }

  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack   = new Set<string>();
  const path:   string[] = [];

  function dfs(node: string): void {
    if (stack.has(node)) {
      // Found a cycle — extract it
      const cycleStart = path.indexOf(node);
      if (cycleStart >= 0) cycles.push(path.slice(cycleStart));
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    stack.add(node);
    path.push(node);

    for (const neighbor of adj.get(node) ?? []) {
      dfs(neighbor);
    }

    path.pop();
    stack.delete(node);
  }

  for (const id of nodes) dfs(id);
  return cycles;
}

// ----------------------------------------------------------------
// Topological sort — Kahn's algorithm
// ----------------------------------------------------------------

function topoSort(nodes: Set<string>, edges: GraphEdge[]): string[] {
  const inDegree = new Map<string, number>();
  const adj      = new Map<string, string[]>();

  for (const id of nodes) { inDegree.set(id, 0); adj.set(id, []); }
  for (const e of edges) {
    if (e.to === "conditional") continue;
    adj.get(e.from)?.push(e.to);
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }

  const queue  = [...nodes].filter((n) => (inDegree.get(n) ?? 0) === 0);
  const result: string[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);
    for (const neighbor of adj.get(node) ?? []) {
      const deg = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, deg);
      if (deg === 0) queue.push(neighbor);
    }
  }

  return result;
}

// ----------------------------------------------------------------
// Mermaid generator (richer than the basic one in StateGraph)
// ----------------------------------------------------------------

export function toMermaidDetailed(descriptor: GraphDescriptor): string {
  const lines: string[] = ["graph TD"];

  /** Strip/escape Mermaid-special characters from node names. */
  const sanitize = (s: string): string =>
    s.replace(/[\n\r;|[\]`<>{}()#&]/g, "_");

  for (const edge of descriptor.edges) {
    const from = sanitize(edge.from);
    if (edge.type === "static") {
      lines.push(`    ${from} --> ${sanitize(edge.to)}`);
    } else {
      lines.push(`    ${from} -->|${edge.label ?? "?"}| ${from}_router`);
      lines.push(`    ${from}_router:::conditional`);
    }
  }

  for (const node of descriptor.nodes) {
    const id = sanitize(node.id);
    if      (node.id === START)    lines.push(`    style ${id} fill:#7c3aed,color:#fff`);
    else if (node.id === END)      lines.push(`    style ${id} fill:#1e1e2e,color:#fff`);
    else if (node.isSubgraph)      lines.push(`    style ${id} fill:#0ea5e9,color:#fff`);
    else if (node.hasRetry)        lines.push(`    style ${id} fill:#f59e0b,color:#000`);
  }

  lines.push(`    classDef conditional fill:#6b7280,color:#fff`);
  return lines.join("\n");
}
