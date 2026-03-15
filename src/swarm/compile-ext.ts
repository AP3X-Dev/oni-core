// ============================================================
// src/swarm/compile-ext.ts — buildSwarmExtensions factory
// Extracted from SwarmGraph.compile() to keep graph.ts thin.
// ============================================================

import { END, Send } from "../types.js";
import type { NodeFn, NodeDefinition, Edge } from "../types.js";
import type { ONISkeletonV3, CompiledGraphInternals, StateGraph } from "../graph.js";
import type { SwarmAgentDef } from "./types.js";
import type { AgentRegistry } from "./registry.js";
import type { BaseSwarmState, PregelRunnerInternals, SwarmExtensions } from "./config.js";
import { createAgentNode } from "./agent-node.js";
import type { SwarmLiveState } from "./agent-node.js";

export function buildSwarmExtensions<S extends BaseSwarmState>(
  skeleton: ONISkeletonV3<S>,
  registry: AgentRegistry<S>,
  inner: StateGraph<S>,
  hasSupervisor: boolean,
  supervisorNodeName: string,
  onErrorPolicy: "fallback" | "throw",
): SwarmExtensions<S> {
  return {
    registry,
    agentStats: () => registry.stats(),
    toMermaid: () => {
      // Read from the live runner's edge map so the diagram reflects
      // agents added/removed via spawnAgent()/removeAgent() after compile.
      const runner = (skeleton as unknown as CompiledGraphInternals<S>)._runner as unknown as PregelRunnerInternals<S> | undefined;
      const edgesBySource = runner?._edgesBySource;
      if (!edgesBySource) return inner.toMermaid(); // safe fallback
      const lines: string[] = ["graph TD"];
      for (const [from, edges] of edgesBySource) {
        for (const edge of edges) {
          if (edge.type === "static" && edge.to !== undefined) {
            lines.push(`    ${from} --> ${edge.to}`);
          } else {
            lines.push(`    ${from} -->|?| conditional_${from}`);
          }
        }
      }
      return lines.join("\n");
    },

    spawnAgent(def: SwarmAgentDef<S>) {
      // spawnAgent requires a supervisor to route the spawned agent back into the graph.
      // In unsupervised topologies there is no return path, so the agent would never execute.
      if (!hasSupervisor) {
        throw new Error(
          `spawnAgent() requires a supervisor node. ` +
          `Use SwarmGraph.hierarchical() to add a supervisor, or call addAgent() before compile() for static topologies.`,
        );
      }

      // Register in the registry
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registry.register(def as SwarmAgentDef<Record<string, unknown>> as any); // SAFE: external boundary — generic registry accepts narrower S

      // Use the same createAgentNode path as static agents so dynamic agents get
      // inbox tracking, timeout clamping, handoff handling, retry backoff, and
      // structured error context — identical behavior to compile-time addAgent().
      const swarmLiveState: SwarmLiveState = { hasSupervisor, supervisorNodeName, onErrorPolicy };
      const agentNode: NodeFn<S> = createAgentNode(def, registry, swarmLiveState);

      // Add node to the compiled runner's nodes map
      const runner = (skeleton as unknown as CompiledGraphInternals<S>)._runner as unknown as PregelRunnerInternals<S> | undefined;
      if (runner?.nodes) {
        runner.nodes.set(def.id, { name: def.id, fn: agentNode } as NodeDefinition<S>);
      }

      // In supervised swarms, add a conditional return edge so the runner
      // knows to send this agent's output back to the supervisor (or END).
      if (hasSupervisor && runner) {
        const returnEdge: Edge<S> = {
          type: "conditional" as const,
          from: def.id,
          condition: (st: S) => (st as Record<string, unknown>).done ? END : supervisorNodeName,
        };
        const edgesBySource = runner._edgesBySource;
        const list = edgesBySource.get(def.id) ?? [];
        list.push(returnEdge);
        edgesBySource.set(def.id, list);
      }
    },

    removeAgent(agentId: string) {
      registry.deregister(agentId);
      const runner = (skeleton as unknown as CompiledGraphInternals<S>)._runner as unknown as PregelRunnerInternals<S> | undefined;
      // If the agent is not in the compiled node map it was never part of the graph —
      // no edges can reference it, so there is nothing structural to clean up.
      if (!runner?.nodes?.has(agentId)) return;
      runner.nodes.delete(agentId);
      // Remove stale edges pointing TO the removed agent so Pregel doesn't try to route to it.
      // Also remove edges FROM the agent (it won't execute, but keeps _edgesBySource clean).
      const edgesBySource = runner._edgesBySource;
      if (edgesBySource) {
        for (const [from, edges] of edgesBySource) {
          let changed = false;
          const updated = edges
            .filter((e) => {
              // Drop static edges that target the removed agent
              if (e.type === "static" && e.to === agentId) { changed = true; return false; }
              return true;
            })
            .map((e) => {
              if (e.type !== "conditional") return e;
              // (a) Remap any pathMap entry whose value is the removed agentId → END
              let newPathMap = e.pathMap;
              if (newPathMap) {
                const stale = Object.values(newPathMap).some((v) => v === agentId);
                if (stale) {
                  newPathMap = Object.fromEntries(
                    Object.entries(newPathMap).map(([k, v]) => [k, v === agentId ? END : v]),
                  ) as Record<string, string>;
                }
              }
              // (b) Wrap the condition so any runtime return of agentId is replaced with END.
              //     We cannot introspect the closure, so we always wrap for safety.
              const orig = e.condition;
              const wrapped: typeof e.condition = (state, cfg) => {
                const result = orig(state, cfg);
                if (!Array.isArray(result)) {
                  // Single NodeName — replace agentId with END
                  return result === agentId ? END : result;
                }
                if (result.length > 0 && result[0] instanceof Send) {
                  // Send[] — filter out Sends targeting the removed agent
                  return (result as Send[]).filter((r) => r.node !== agentId);
                }
                // NodeName[] — replace agentId entries with END
                return (result as string[]).map((r) => (r === agentId ? END : r));
              };
              changed = true;
              return { ...e, condition: wrapped, pathMap: newPathMap };
            });
          if (changed) edgesBySource.set(from, updated);
        }
        edgesBySource.delete(agentId);
      }
    },
  };
}
