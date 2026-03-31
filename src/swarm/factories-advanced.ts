// ============================================================
// src/swarm/factories-advanced.ts — Advanced topology factory functions
// Same pattern as factories.ts: each function receives a pre-constructed
// SwarmGraph<S>, wires it, and returns it.
//
// `import type { SwarmGraph }` avoids runtime circular dep.
// ============================================================

import { START, END } from "../types.js";
import type { RubricConfig, RubricScore } from "./types.js";
import type {
  BaseSwarmState,
  CritiqueRefineConfig,
} from "./config.js";

// SwarmGraph — type-only to avoid circular dep
import type { SwarmGraph } from "./graph.js";

// ----------------------------------------------------------------
// buildCritiqueRefine
// ----------------------------------------------------------------

export function buildCritiqueRefine<S extends BaseSwarmState>(
  config: CritiqueRefineConfig<S>,
  swarm: SwarmGraph<S>,
): SwarmGraph<S> {
  const maxRounds = config.maxRounds;
  const isRubric = typeof config.feedback !== "string";
  const rubric = isRubric ? config.feedback as RubricConfig : null;

  // Register agents
  swarm.registry.register(config.generator);
  swarm.agentIds.add(config.generator.id);
  swarm.registry.register(config.critic);
  swarm.agentIds.add(config.critic.id);

  // ── Generator node ──
  swarm.inner.addNode("__cr_generator__", async (state: S, cfg?) => {
    const result = await config.generator.skeleton.invoke(
      { ...state } as S,
      { ...cfg, agentId: config.generator.id },
    );
    const ctx = (result as Record<string, unknown>).context as Record<string, unknown> | undefined;
    return {
      context: {
        ...(state.context ?? {}),
        ...((ctx as Record<string, unknown>) ?? {}),
        round: ((state.context as Record<string, unknown>)?.round as number ?? 0) + 1,
      },
    } as Partial<S>;
  });

  // ── Critic node ──
  swarm.inner.addNode("__cr_critic__", async (state: S, cfg?) => {
    const result = await config.critic.skeleton.invoke(
      { ...state } as S,
      { ...cfg, agentId: config.critic.id },
    );
    const ctx = (result as Record<string, unknown>).context as Record<string, unknown> | undefined;
    const merged = { ...(state.context ?? {}), ...((ctx as Record<string, unknown>) ?? {}) };
    const round = (merged.round as number) ?? 1;

    let isDone = false;

    if (isRubric && rubric) {
      // Rubric mode: check scores
      const scores = (merged.scores as RubricScore[]) ?? [];
      if (scores.length > 0) {
        const allPass = scores.every((s) => s.score >= rubric.passThreshold);
        if (rubric.globalThreshold != null) {
          const totalWeight = rubric.dimensions.reduce((sum, d) => sum + (d.weight ?? 1), 0);
          const weightedAvg = scores.reduce((sum, s) => {
            const dim = rubric.dimensions.find((d) => d.name === s.dimension);
            return sum + s.score * (dim?.weight ?? 1);
          }, 0) / totalWeight;
          isDone = allPass && weightedAvg >= rubric.globalThreshold;
        } else {
          isDone = allPass;
        }
      }
    } else {
      // Freeform mode: check approved flag
      isDone = !!(merged.approved);
    }

    // Hard cap
    if (round >= maxRounds) isDone = true;

    return {
      context: merged,
      done: isDone,
    } as Partial<S>;
  });

  // ── Edges ──
  swarm.inner.addEdge(START, "__cr_generator__");
  swarm.inner.addEdge("__cr_generator__", "__cr_critic__");
  swarm.inner.addConditionalEdges("__cr_critic__", (state: S) => {
    if (state.done) return END;
    return "__cr_generator__";
  });

  return swarm;
}
