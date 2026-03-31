// ============================================================
// src/swarm/factories-advanced.ts — Advanced topology factory functions
// Same pattern as factories.ts: each function receives a pre-constructed
// SwarmGraph<S>, wires it, and returns it.
//
// `import type { SwarmGraph }` avoids runtime circular dep.
// ============================================================

import { START, END } from "../types.js";
import type { RubricConfig, RubricScore, VerificationResult } from "./types.js";
import type {
  BaseSwarmState,
  CritiqueRefineConfig,
  StepwiseVerifyConfig,
  EnsembleVoteConfig,
} from "./config.js";
import { runWithTimeout } from "../internal/timeout.js";

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

// ----------------------------------------------------------------
// buildStepwiseVerify
// ----------------------------------------------------------------

export function buildStepwiseVerify<S extends BaseSwarmState>(
  config: StepwiseVerifyConfig<S>,
  swarm: SwarmGraph<S>,
): SwarmGraph<S> {
  const onFailure = config.onStageFailure ?? "halt";
  const stages = config.stages;

  for (const stage of stages) {
    swarm.registry.register(stage.worker);
    swarm.agentIds.add(stage.worker.id);
  }

  swarm.inner.addNode("__sv_runner__", async (state: S, cfg?) => {
    const stageResults: Array<{
      stageIndex: number;
      workerId: string;
      status: "passed" | "failed" | "skipped";
      attempts: number;
      verificationHistory: VerificationResult[];
      output: unknown;
    }> = [];

    let failedStage: { stageIndex: number; reason: string } | null = null;
    let accumulatedContext: Record<string, unknown> = { ...(state.context ?? {}) };

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      const verificationHistory: VerificationResult[] = [];
      let passed = false;
      let attempts = 0;
      let lastOutput: unknown = null;

      for (let attempt = 0; attempt <= stage.maxRetries; attempt++) {
        attempts++;

        const inputState = {
          ...state,
          context: {
            ...accumulatedContext,
            ...(verificationHistory.length > 0
              ? { verifierFeedback: verificationHistory[verificationHistory.length - 1].feedback }
              : {}),
          },
        } as S;

        const workerResult = await stage.worker.skeleton.invoke(
          inputState,
          { ...cfg, agentId: stage.worker.id },
        );
        lastOutput = workerResult;

        const workerCtx = (workerResult as Record<string, unknown>).context as Record<string, unknown> | undefined;
        if (workerCtx) {
          accumulatedContext = { ...accumulatedContext, ...workerCtx };
        }

        let verification: VerificationResult;
        if (typeof stage.verifier === "function") {
          verification = await stage.verifier(workerResult, { ...state, context: accumulatedContext } as S);
        } else {
          const verifierResult = await stage.verifier.skeleton.invoke(
            { ...state, context: accumulatedContext } as S,
            { ...cfg, agentId: stage.verifier.id },
          );
          const vCtx = (verifierResult as Record<string, unknown>).context as Record<string, unknown> | undefined;
          verification = {
            passed: !!(vCtx?.passed),
            feedback: (vCtx?.feedback as string) ?? "",
            confidence: vCtx?.confidence as number | undefined,
          };
        }

        verificationHistory.push(verification);

        if (verification.passed) {
          passed = true;
          break;
        }

        if (stage.retryDelayMs && attempt < stage.maxRetries) {
          await new Promise((r) => setTimeout(r, stage.retryDelayMs));
        }
      }

      if (passed) {
        stageResults.push({
          stageIndex: i, workerId: stage.worker.id,
          status: "passed", attempts, verificationHistory, output: lastOutput,
        });
      } else if (onFailure === "halt") {
        stageResults.push({
          stageIndex: i, workerId: stage.worker.id,
          status: "failed", attempts, verificationHistory, output: lastOutput,
        });
        failedStage = {
          stageIndex: i,
          reason: verificationHistory[verificationHistory.length - 1]?.feedback ?? "verification failed",
        };
        break;
      } else {
        stageResults.push({
          stageIndex: i, workerId: stage.worker.id,
          status: "skipped", attempts, verificationHistory, output: lastOutput,
        });
      }
    }

    return {
      context: { ...accumulatedContext, stageResults, failedStage },
      done: true,
    } as Partial<S>;
  });

  swarm.inner.addEdge(START, "__sv_runner__");
  swarm.inner.addEdge("__sv_runner__", END);

  return swarm;
}

// ----------------------------------------------------------------
// buildEnsembleVote
// ----------------------------------------------------------------

export function buildEnsembleVote<S extends BaseSwarmState>(
  config: EnsembleVoteConfig<S>,
  swarm: SwarmGraph<S>,
): SwarmGraph<S> {
  const timeoutMs = config.timeoutMs;

  for (const agent of config.agents) {
    swarm.registry.register(agent);
    swarm.agentIds.add(agent.id);
  }

  swarm.inner.addNode("__ev_runner__", async (state: S, cfg?) => {
    async function runAgent(agent: typeof config.agents[0]) {
      try {
        const result = await runWithTimeout(
          () => agent.skeleton.invoke(
            { ...state } as S,
            { ...cfg, agentId: agent.id },
          ),
          timeoutMs,
          () => new Error(`Agent "${agent.id}" timed out after ${timeoutMs}ms`),
        );
        return { id: agent.id, result, error: null };
      } catch (err) {
        return { id: agent.id, result: null, error: err };
      }
    }

    const allResults = await Promise.all(config.agents.map(runAgent));

    const agentResults: Record<string, unknown> = {};
    for (const { id, result, error } of allResults) {
      if (error) {
        agentResults[id] = {
          _error: true, agent: id,
          error: String(error instanceof Error ? error.message : error),
        };
      } else {
        agentResults[id] = result;
      }
    }

    const stateWithResults = { ...state, agentResults } as S;

    // Aggregate based on mode
    if (typeof config.mode === "function") {
      const custom = config.mode(agentResults, stateWithResults);
      return { agentResults, ...custom, done: true } as Partial<S>;
    }

    if (config.mode === "vote" && config.judge) {
      const resultsText = Object.entries(agentResults)
        .filter(([, v]) => !(v as any)?._error)
        .map(([id, r]) => `${id}: ${JSON.stringify(r)}`)
        .join("\n\n");

      const response = await config.judge.model.chat({
        messages: [{ role: "user", content: `Pick the best response and explain why.\n\n${resultsText}\n\nRespond with JSON: {"winner": "agent-id", "reasoning": "why"}` }],
        systemPrompt: config.judge.systemPrompt ?? "You are evaluating multiple agent responses. Pick the best one.",
      });

      let winner: string | null = null;
      let reasoning = "";
      try {
        const parsed = JSON.parse(response.content);
        winner = parsed.winner ?? null;
        reasoning = parsed.reasoning ?? "";
      } catch {
        winner = null;
        reasoning = response.content;
      }

      return {
        agentResults,
        context: { ...(state.context ?? {}), winner, reasoning },
        done: true,
      } as Partial<S>;
    }

    if (config.mode === "synthesize" && config.synthesizer) {
      const synthResult = await config.synthesizer.skeleton.invoke(
        stateWithResults,
        { ...cfg, agentId: config.synthesizer.id },
      );
      const synthCtx = (synthResult as Record<string, unknown>).context as Record<string, unknown> | undefined;

      return {
        agentResults,
        context: { ...(state.context ?? {}), ...(synthCtx ?? {}) },
        done: true,
      } as Partial<S>;
    }

    return { agentResults, done: true } as Partial<S>;
  });

  swarm.inner.addEdge(START, "__ev_runner__");
  swarm.inner.addEdge("__ev_runner__", END);

  return swarm;
}
