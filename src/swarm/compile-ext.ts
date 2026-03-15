// ============================================================
// src/swarm/compile-ext.ts — buildSwarmExtensions factory
// Extracted from SwarmGraph.compile() to keep graph.ts thin.
// ============================================================

import { Command, END } from "../types.js";
import type { ONIConfig, NodeFn, NodeDefinition, Edge } from "../types.js";
import type { ONISkeletonV3, CompiledGraphInternals, StateGraph } from "../graph.js";
import type { SwarmAgentDef } from "./types.js";
import type { AgentRegistry } from "./registry.js";
import type { BaseSwarmState, PregelRunnerInternals, SwarmExtensions } from "./config.js";
import { getInbox } from "./mailbox.js";

export function buildSwarmExtensions<S extends BaseSwarmState>(
  skeleton: ONISkeletonV3<S>,
  registry: AgentRegistry<S>,
  inner: StateGraph<S>,
  hasSupervisor: boolean,
  supervisorNodeName: string,
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

      // Create the agent node function (same logic as addAgent)
      const agentNode: NodeFn<S> = async (state: S, config?: ONIConfig) => {
        registry.markBusy(def.id);
        await def.hooks?.onStart?.(def.id, state as Record<string, unknown>);

        const maxRetries = def.maxRetries ?? 2;
        let lastError: unknown;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            const result = await def.skeleton.invoke(
              { ...state, context: { ...(state.context ?? {}), inbox: getInbox(state.swarmMessages ?? [], def.id) } } as S,
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
      if (runner?.nodes) runner.nodes.delete(agentId);
      // Remove stale edges pointing TO the removed agent so Pregel doesn't try to route to it.
      // Also remove edges FROM the agent (it won't execute, but keeps _edgesBySource clean).
      if (runner?._edgesBySource) {
        const edgesBySource = runner._edgesBySource;
        for (const [from, edges] of edgesBySource) {
          const filtered = edges.filter((e) => !(e.type === "static" && e.to === agentId));
          if (filtered.length !== edges.length) edgesBySource.set(from, filtered);
        }
        edgesBySource.delete(agentId);
      }
    },
  };
}
