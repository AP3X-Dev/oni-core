// ============================================================
// src/swarm/factories-advanced.ts — Advanced topology factory functions
// Same pattern as factories.ts: each function receives a pre-constructed
// SwarmGraph<S>, wires it, and returns it.
//
// `import type { SwarmGraph }` avoids runtime circular dep.
// ============================================================

import { START, END } from "../types.js";
import type { RubricConfig, RubricScore, VerificationResult, Vulnerability, Patch, VulnerabilitySeverity, SwarmAgentDef } from "./types.js";
import type {
  BaseSwarmState,
  CritiqueRefineConfig,
  StepwiseVerifyConfig,
  EnsembleVoteConfig,
  SpeculativeExecutionConfig,
  RedTeamConfig,
  SocraticElicitConfig,
  AutoResearchConfig,
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

// ----------------------------------------------------------------
// buildSpeculativeExecution
// ----------------------------------------------------------------

export function buildSpeculativeExecution<S extends BaseSwarmState>(
  config: SpeculativeExecutionConfig<S>,
  swarm: SwarmGraph<S>,
): SwarmGraph<S> {
  const timeoutMs = config.timeoutMs;
  const perStrategyTimeoutMs = config.perStrategyTimeoutMs;

  for (const agent of config.strategies) {
    swarm.registry.register(agent);
    swarm.agentIds.add(agent.id);
  }

  swarm.inner.addNode("__se_race__", async (state: S, cfg?) => {
    type RaceResult = { id: string; result: unknown; error: unknown | null };
    const abortController = new AbortController();

    const strategyPromises: Promise<RaceResult>[] = config.strategies.map((agent) => {
      let p: Promise<RaceResult> = agent.skeleton
        .invoke(
          { ...state } as S,
          { ...cfg, agentId: agent.id, signal: abortController.signal },
        )
        .then(
          (result) => ({ id: agent.id, result, error: null } as RaceResult),
          (err) => ({ id: agent.id, result: null, error: err } as RaceResult),
        );

      if (perStrategyTimeoutMs != null) {
        let timer: ReturnType<typeof setTimeout>;
        const timeoutP = new Promise<RaceResult>((resolve) => {
          timer = setTimeout(
            () => resolve({ id: agent.id, result: null, error: new Error("timeout") }),
            perStrategyTimeoutMs,
          );
        });
        p = Promise.race([p, timeoutP]).finally(() => clearTimeout(timer!));
      }
      return p;
    });

    let globalTimer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs != null) {
      globalTimer = setTimeout(() => abortController.abort(), timeoutMs);
    }

    const allResults: RaceResult[] = [];

    const winner = await new Promise<RaceResult | null>((resolve) => {
      let resolved = false;
      let remaining = strategyPromises.length;
      if (remaining === 0) { resolve(null); return; }

      for (const p of strategyPromises) {
        p.then(async (r) => {
          allResults.push(r);
          if (resolved) return;

          let valid = false;
          try {
            if (!r.error) valid = await config.validator(r.result, state);
          } catch { /* validator threw = not valid */ }

          if (valid) {
            resolved = true;
            resolve(r);
            abortController.abort();
          } else {
            remaining--;
            if (remaining === 0) resolve(null);
          }
        });
      }
    });

    if (globalTimer) clearTimeout(globalTimer);

    let winnerId: string | null = null;
    let winnerResult: unknown = null;
    const cancelledStrategies: string[] = [];

    if (winner) {
      winnerId = winner.id;
      winnerResult = winner.result;
      for (const agent of config.strategies) {
        if (agent.id !== winnerId) {
          cancelledStrategies.push(agent.id);
          try { await config.onCancel?.(agent.id); } catch { /* swallow */ }
        }
      }
    }

    const agentResults: Record<string, unknown> = {};
    for (const r of allResults) {
      agentResults[r.id] = r.error ? { _error: true, error: String(r.error) } : r.result;
    }

    return {
      agentResults,
      context: {
        ...(state.context ?? {}),
        winnerId,
        winnerResult,
        cancelledStrategies,
      },
      done: true,
    } as Partial<S>;
  });

  swarm.inner.addEdge(START, "__se_race__");
  swarm.inner.addEdge("__se_race__", END);

  return swarm;
}

// ----------------------------------------------------------------
// buildRedTeam
// ----------------------------------------------------------------

const SEVERITY_ORDER: Record<VulnerabilitySeverity, number> = {
  low:      0,
  medium:   1,
  high:     2,
  critical: 3,
};

export function buildRedTeam<S extends BaseSwarmState>(
  config: RedTeamConfig<S>,
  swarm: SwarmGraph<S>,
): SwarmGraph<S> {
  const maxRounds = config.maxRounds;
  const severityThreshold = config.severityThreshold;

  swarm.registry.register(config.attacker);
  swarm.agentIds.add(config.attacker.id);
  swarm.registry.register(config.builder);
  swarm.agentIds.add(config.builder.id);

  swarm.inner.addNode("__rt_runner__", async (state: S, cfg?) => {
    let cumulativeVulnerabilities: Vulnerability[] =
      ((state.context as Record<string, unknown>)?.vulnerabilities as Vulnerability[] | undefined) ?? [];
    let cumulativePatches: Patch[] =
      ((state.context as Record<string, unknown>)?.patches as Patch[] | undefined) ?? [];
    let currentRound = 0;

    for (let round = 0; round < maxRounds; round++) {
      currentRound = round + 1;

      // ── Run attacker ──
      const attackerInput = {
        ...state,
        context: {
          ...(state.context ?? {}),
          vulnerabilities: cumulativeVulnerabilities,
          patches: cumulativePatches,
          attackSurface: config.attackSurface ?? [],
          currentRound,
        },
      } as S;

      const attackerResult = await config.attacker.skeleton.invoke(
        attackerInput,
        { ...cfg, agentId: config.attacker.id },
      );
      const attackerCtx = (attackerResult as Record<string, unknown>).context as Record<string, unknown> | undefined;
      let newVulnerabilities: Vulnerability[] =
        (attackerCtx?.newVulnerabilities as Vulnerability[] | undefined) ?? [];

      // ── Filter by severity threshold ──
      if (severityThreshold !== undefined) {
        const minLevel = SEVERITY_ORDER[severityThreshold];
        newVulnerabilities = newVulnerabilities.filter(
          (v) => SEVERITY_ORDER[v.severity] >= minLevel,
        );
      }

      // ── Termination: no significant findings ──
      if (newVulnerabilities.length === 0) {
        break;
      }

      // ── Accumulate vulnerabilities ──
      cumulativeVulnerabilities = [...cumulativeVulnerabilities, ...newVulnerabilities];

      // ── Run builder ──
      const builderInput = {
        ...state,
        context: {
          ...(state.context ?? {}),
          vulnerabilities: cumulativeVulnerabilities,
          patches: cumulativePatches,
          newVulnerabilities,
          currentRound,
        },
      } as S;

      const builderResult = await config.builder.skeleton.invoke(
        builderInput,
        { ...cfg, agentId: config.builder.id },
      );
      const builderCtx = (builderResult as Record<string, unknown>).context as Record<string, unknown> | undefined;
      const newPatches: Patch[] =
        (builderCtx?.newPatches as Patch[] | undefined) ?? [];

      cumulativePatches = [...cumulativePatches, ...newPatches];

      // Update vulnerability statuses based on patches
      const patchedIds = new Set(newPatches.map((p) => p.vulnerabilityId));
      cumulativeVulnerabilities = cumulativeVulnerabilities.map((v) =>
        patchedIds.has(v.id) ? { ...v, status: "patched" as const } : v,
      );
    }

    return {
      context: {
        ...(state.context ?? {}),
        vulnerabilities: cumulativeVulnerabilities,
        patches: cumulativePatches,
        currentRound,
      },
      done: true,
    } as Partial<S>;
  });

  swarm.inner.addEdge(START, "__rt_runner__");
  swarm.inner.addEdge("__rt_runner__", END);

  return swarm;
}

// ----------------------------------------------------------------
// buildSocraticElicit
// ----------------------------------------------------------------

export function buildSocraticElicit<S extends BaseSwarmState>(
  config: SocraticElicitConfig<S>,
  swarm: SwarmGraph<S>,
): SwarmGraph<S> {
  const {
    interviewer,
    respondent,
    synthesizer,
    coverageDimensions,
    completionThreshold,
    maxQuestions,
    outputFormat,
  } = config;

  // Register interviewer always
  swarm.registry.register(interviewer);
  swarm.agentIds.add(interviewer.id);

  // Register respondent only if it's an agent (not "interrupt")
  if (respondent !== "interrupt") {
    const respondentDef = respondent as SwarmAgentDef<S>;
    swarm.registry.register(respondentDef);
    swarm.agentIds.add(respondentDef.id);
  }

  // Register synthesizer if distinct from interviewer
  if (synthesizer && synthesizer.id !== interviewer.id) {
    swarm.registry.register(synthesizer);
    swarm.agentIds.add(synthesizer.id);
  }

  swarm.inner.addNode("__so_runner__", async (state: S, cfg?) => {
    const dimensions = coverageDimensions;
    let coverageMap: Record<string, boolean> =
      ((state.context as Record<string, unknown>)?.coverageMap as Record<string, boolean> | undefined) ??
      Object.fromEntries(dimensions.map((d) => [d, false]));

    const transcript: Array<{ question: string; answer: string; questionIndex: number }> =
      ((state.context as Record<string, unknown>)?.transcript as Array<{ question: string; answer: string; questionIndex: number }> | undefined) ?? [];

    let questionCount: number =
      ((state.context as Record<string, unknown>)?.questionCount as number | undefined) ?? 0;

    // ── Interview loop ──
    while (true) {
      const coveredCount = Object.values(coverageMap).filter(Boolean).length;

      // Check coverage threshold
      if (dimensions.length > 0 && coveredCount / dimensions.length >= completionThreshold) {
        break;
      }

      // Check max questions
      if (questionCount >= maxQuestions) {
        break;
      }

      // ── Step 1: Run interviewer ──
      const interviewerInput = {
        ...state,
        context: {
          ...(state.context ?? {}),
          coverageMap,
          transcript,
          coverageDimensions: dimensions,
          questionCount,
        },
      } as S;

      const interviewerResult = await interviewer.skeleton.invoke(
        interviewerInput,
        { ...cfg, agentId: interviewer.id },
      );
      const interviewerCtx = (interviewerResult as Record<string, unknown>).context as Record<string, unknown> | undefined;

      // Extract currentQuestion and updated coverageMap from interviewer output
      const currentQuestion = (interviewerCtx?.currentQuestion as string | undefined) ?? "";
      if (interviewerCtx?.coverageMap != null) {
        coverageMap = { ...coverageMap, ...(interviewerCtx.coverageMap as Record<string, boolean>) };
      }

      // ── Step 2: Run respondent ──
      let currentAnswer: string;

      if (respondent === "interrupt") {
        // Full interrupt() integration is a future enhancement
        currentAnswer = "[INTERRUPT: awaiting human input]";
      } else {
        const respondentDef = respondent as SwarmAgentDef<S>;
        const respondentInput = {
          ...state,
          context: {
            ...(state.context ?? {}),
            coverageMap,
            transcript,
            coverageDimensions: dimensions,
            questionCount,
            currentQuestion,
          },
        } as S;

        const respondentResult = await respondentDef.skeleton.invoke(
          respondentInput,
          { ...cfg, agentId: respondentDef.id },
        );
        const respondentCtx = (respondentResult as Record<string, unknown>).context as Record<string, unknown> | undefined;
        currentAnswer = (respondentCtx?.currentAnswer as string | undefined) ?? "";
      }

      // ── Step 3: Append to transcript ──
      transcript.push({ question: currentQuestion, answer: currentAnswer, questionIndex: questionCount });
      questionCount++;

      // ── Step 4: Check coverage after this exchange ──
      const coveredNow = Object.values(coverageMap).filter(Boolean).length;
      if (dimensions.length > 0 && coveredNow / dimensions.length >= completionThreshold) {
        break;
      }

      // ── Step 5: Check maxQuestions ──
      if (questionCount >= maxQuestions) {
        break;
      }
    }

    // ── Step 6: Run synthesizer ──
    const synthAgent = synthesizer ?? interviewer;
    const synthInput = {
      ...state,
      context: {
        ...(state.context ?? {}),
        coverageMap,
        transcript,
        coverageDimensions: dimensions,
        questionCount,
        synthesize: true,
        outputFormat: outputFormat ?? null,
      },
    } as S;

    const synthResult = await synthAgent.skeleton.invoke(
      synthInput,
      { ...cfg, agentId: synthAgent.id },
    );
    const synthCtx = (synthResult as Record<string, unknown>).context as Record<string, unknown> | undefined;
    const synthesizedOutput = (synthCtx?.synthesizedOutput as unknown) ?? null;

    return {
      context: {
        ...(state.context ?? {}),
        coverageMap,
        transcript,
        coverageDimensions: dimensions,
        questionCount,
        synthesizedOutput,
      },
      done: true,
    } as Partial<S>;
  });

  swarm.inner.addEdge(START, "__so_runner__");
  swarm.inner.addEdge("__so_runner__", END);

  return swarm;
}

// ----------------------------------------------------------------
// buildAutoResearch
// ----------------------------------------------------------------

export function buildAutoResearch<S extends BaseSwarmState>(
  config: AutoResearchConfig<S>,
  swarm: SwarmGraph<S>,
): SwarmGraph<S> {
  const { decomposer, researcher, synthesizer, maxDepth, confidenceThreshold } = config;
  const maxConcurrentSearches = config.maxConcurrentSearches ?? Infinity;

  swarm.registry.register(decomposer);
  swarm.agentIds.add(decomposer.id);
  swarm.registry.register(researcher);
  swarm.agentIds.add(researcher.id);
  swarm.registry.register(synthesizer);
  swarm.agentIds.add(synthesizer.id);

  swarm.inner.addNode("__ar_runner__", async (state: S, cfg?) => {
    let findings: Record<string, { subQuestion: string; answer: string; sources: unknown[] }> =
      ((state.context as Record<string, unknown>)?.findings as Record<string, { subQuestion: string; answer: string; sources: unknown[] }> | undefined) ?? {};
    let gaps: string[] =
      ((state.context as Record<string, unknown>)?.gaps as string[] | undefined) ?? [];
    let synthesis: string | undefined =
      (state.context as Record<string, unknown>)?.synthesis as string | undefined;
    let confidence = 0;
    let currentDepth = 0;

    // ── Research loop ──
    for (let depth = 0; depth < maxDepth; depth++) {
      // ── Step 1: Decompose ──
      const decomposerInput = {
        ...state,
        context: {
          ...(state.context ?? {}),
          findings,
          gaps,
          currentDepth: depth,
        },
      } as S;

      const decomposerResult = await decomposer.skeleton.invoke(
        decomposerInput,
        { ...cfg, agentId: decomposer.id },
      );
      const decomposerCtx = (decomposerResult as Record<string, unknown>).context as Record<string, unknown> | undefined;
      const subQuestions: string[] = (decomposerCtx?.subQuestions as string[] | undefined) ?? [];

      // ── Step 2: Terminate if no sub-questions ──
      if (subQuestions.length === 0) {
        break;
      }

      // ── Step 3: Research sub-questions in parallel (capped) ──
      const cap = Math.min(subQuestions.length, maxConcurrentSearches);
      const batches: string[][] = [];
      for (let i = 0; i < subQuestions.length; i += cap) {
        batches.push(subQuestions.slice(i, i + cap));
      }

      for (const batch of batches) {
        const batchResults = await Promise.all(
          batch.map(async (subQuestion) => {
            const researcherInput = {
              ...state,
              context: {
                ...(state.context ?? {}),
                findings,
                gaps,
                currentDepth: depth,
                currentSubQuestion: subQuestion,
              },
            } as S;

            const researcherResult = await researcher.skeleton.invoke(
              researcherInput,
              { ...cfg, agentId: researcher.id },
            );
            const researcherCtx = (researcherResult as Record<string, unknown>).context as Record<string, unknown> | undefined;
            const finding = researcherCtx?.finding as { subQuestion: string; answer: string; sources: unknown[] } | undefined;
            return { subQuestion, finding };
          }),
        );

        // ── Step 4: Accumulate findings ──
        for (const { subQuestion, finding } of batchResults) {
          const key = subQuestion;
          findings = {
            ...findings,
            [key]: finding ?? { subQuestion, answer: "", sources: [] },
          };
        }
      }

      // ── Step 5: Synthesize ──
      const synthesizerInput = {
        ...state,
        context: {
          ...(state.context ?? {}),
          findings,
          currentDepth: depth,
        },
      } as S;

      const synthesizerResult = await synthesizer.skeleton.invoke(
        synthesizerInput,
        { ...cfg, agentId: synthesizer.id },
      );
      const synthesizerCtx = (synthesizerResult as Record<string, unknown>).context as Record<string, unknown> | undefined;
      synthesis = (synthesizerCtx?.synthesis as string | undefined) ?? synthesis;
      confidence = (synthesizerCtx?.confidence as number | undefined) ?? 0;
      gaps = (synthesizerCtx?.gaps as string[] | undefined) ?? [];

      // Completed this depth
      currentDepth = depth + 1;

      // ── Step 6: Triple termination ──
      if (confidence >= confidenceThreshold || gaps.length === 0) {
        break;
      }

      // Gaps become the input for next depth's decomposer via context.gaps
    }

    return {
      context: {
        ...(state.context ?? {}),
        findings,
        synthesis,
        confidence,
        gaps,
        currentDepth,
      },
      done: true,
    } as Partial<S>;
  });

  swarm.inner.addEdge(START, "__ar_runner__");
  swarm.inner.addEdge("__ar_runner__", END);

  return swarm;
}
