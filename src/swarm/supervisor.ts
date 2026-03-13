// ============================================================
// @oni.bot/core/swarm — Supervisor
// ============================================================
// The orchestrating node in a hierarchical swarm.
// Routes tasks to agents using LLM, rule-based, or round-robin
// strategies. Collects results and decides when to END.
// ============================================================

import { END } from "../types.js";
import type { NodeFn } from "../types.js";
import { Command } from "../types.js";
import type { SupervisorConfig, RuleRoute } from "./types.js";
import type { AgentRegistry } from "./registry.js";
import type { ONIModel } from "../models/types.js";
import { ONIError } from "../errors.js";

// ----------------------------------------------------------------
// State contract for Supervisor-managed swarms
// ----------------------------------------------------------------

export interface SupervisorState {
  task:            string;
  context:         Record<string, unknown>;
  supervisorRound: number;
  currentAgent:    string | null;
  agentResults:    Record<string, unknown>;
  messages:        Array<{ role: string; content: string }>;
  done:            boolean;
  [key: string]:   unknown;
}

// ----------------------------------------------------------------
// createSupervisorNode — factory that returns a NodeFn
// ----------------------------------------------------------------

export function createSupervisorNode<S extends SupervisorState>(
  registry: AgentRegistry<S>,
  config:   SupervisorConfig<S>
): NodeFn<S> {
  // Validate config
  if (config.strategy === "llm" && !config.model) {
    throw new ONIError(
      'Strategy "llm" requires a model to be provided.',
      { code: "ONI_SWARM_CONFIG", category: "SWARM", recoverable: false },
    );
  }

  const maxRounds = config.maxRounds ?? 10;
  const deadlineMs = config.deadlineMs;
  const autoRecover = config.autoRecover ?? false;

  return async (state: S): Promise<Partial<S> | Command<S>> => {
    const round = state.supervisorRound ?? 0;
    const task  = String(state[config.taskField] ?? "");

    // Deadline is computed at invoke-time: on round 0, set the absolute deadline in context.
    // On subsequent rounds, read it from context. This ensures each invoke() gets a fresh deadline.
    let deadlineAbsolute: number | null = null;
    if (deadlineMs != null) {
      const ctx = (state.context ?? {}) as Record<string, unknown>;
      if (round === 0 || ctx.__deadlineAbsolute === undefined) {
        deadlineAbsolute = Date.now() + deadlineMs;
      } else {
        deadlineAbsolute = ctx.__deadlineAbsolute as number;
      }
    }

    // Guard: deadline expired
    if (deadlineAbsolute != null && Date.now() >= deadlineAbsolute) {
      return new Command<S>({
        update: { supervisorRound: round } as Partial<S>,
        goto:   END,
      });
    }

    // Guard: max rounds
    if (round >= maxRounds || state.done) {
      return new Command<S>({
        update: { supervisorRound: round } as Partial<S>,
        goto:   END,
      });
    }

    // Check if last agent marked task as done
    if (state.done) {
      return new Command<S>({ update: {} as Partial<S>, goto: END });
    }

    const rawCtx = (config.contextField ? state[config.contextField] : {}) as Record<string, unknown>;
    // Enrich context with supervisorRound so rules/LLM can inspect the current round
    const ctx: Record<string, unknown> = { ...rawCtx, supervisorRound: round };

    // Auto-recovery: if lastAgentError exists and autoRecover is enabled,
    // find an idle agent with matching capabilities
    if (autoRecover && ctx.lastAgentError) {
      const errorCtx = ctx.lastAgentError as { agent: string; error: string };
      const failedAgent = registry.get(errorCtx.agent);
      if (failedAgent) {
        const failedCaps = new Set(failedAgent.def.capabilities.map((c) => c.name.toLowerCase()));
        if (failedCaps.size > 0) {
          // Find an idle agent with matching capability (not the failed agent)
          const idle = registry.findIdle().filter((a) => a.def.id !== errorCtx.agent);
          const match = idle.find((a) =>
            a.def.capabilities.some((c) => failedCaps.has(c.name.toLowerCase())),
          );
          if (match) {
            return new Command<S>({
              update: {
                supervisorRound: round + 1,
                currentAgent: match.def.id,
                context: { ...(rawCtx as any), lastAgentError: undefined },
                messages: [
                  ...state.messages,
                  { role: "system", content: `Supervisor auto-recovering to: ${match.def.role}` },
                ],
              } as Partial<S>,
              goto: match.def.id,
            });
          }
        }
      }
    }

    // Route to next agent
    let targetAgentId: string | null = null;

    switch (config.strategy) {
      case "llm":
        targetAgentId = await routeViaLLM(task, ctx, registry, config.model!, config.systemPrompt);
        break;
      case "rule":
        targetAgentId = routeViaRules(task, ctx, config.rules ?? []);
        break;
      case "round-robin":
        targetAgentId = routeRoundRobin(registry, round);
        break;
      case "capability":
        targetAgentId = routeViaCapability(ctx, registry);
        break;
    }

    if (!targetAgentId) {
      return new Command<S>({ update: {} as Partial<S>, goto: END });
    }

    const agentDef = registry.getDef(targetAgentId);
    if (!agentDef) {
      return new Command<S>({ update: {} as Partial<S>, goto: END });
    }

    return new Command<S>({
      update: {
        supervisorRound: round + 1,
        currentAgent:    targetAgentId,
        ...(deadlineAbsolute != null ? { context: { ...(rawCtx as any), __deadlineAbsolute: deadlineAbsolute } } : {}),
        messages: [
          ...state.messages,
          { role: "system", content: `Supervisor routing to: ${agentDef.role}` },
        ],
      } as Partial<S>,
      goto: targetAgentId,
    });
  };
}

// ----------------------------------------------------------------
// Routing strategies
// ----------------------------------------------------------------

async function routeViaLLM<S extends Record<string, unknown>>(
  task:         string,
  context:      Record<string, unknown>,
  registry:     AgentRegistry<S>,
  model:        ONIModel,
  systemPrompt?: string,
): Promise<string | null> {
  const manifest = registry.toManifest();
  const agentIds = registry.getAll().map((a) => a.def.id);

  const prompt = [
    `TASK: ${task}`,
    context && Object.keys(context).length
      ? `CONTEXT: ${JSON.stringify(context, null, 2)}`
      : "",
    "",
    "AVAILABLE AGENTS:",
    manifest,
    "",
    `Respond with ONLY the agent ID. Valid IDs: ${agentIds.join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await model.chat({
    messages: [{ role: "user", content: prompt }],
    systemPrompt: systemPrompt ?? "You are an agent router. Choose the best agent for the given task.",
  });

  const cleaned = response.content.trim().replace(/['"]/g, "");

  // Validate the LLM returned a real agent ID
  if (agentIds.includes(cleaned)) return cleaned;

  // Fuzzy: find the first agent ID that appears in the response
  return agentIds.find((id) => response.content.includes(id)) ?? null;
}

function routeViaRules(
  task:    string,
  context: Record<string, unknown>,
  rules:   RuleRoute[]
): string | null {
  for (const rule of rules) {
    if (rule.condition(task, context)) return rule.agentId;
  }
  return null;
}

function routeRoundRobin<S extends Record<string, unknown>>(
  registry: AgentRegistry<S>,
  round:    number
): string | null {
  const agents = registry.findIdle();
  if (!agents.length) {
    // Fall back to all agents if none idle
    const all = registry.getAll().filter((a) => (a as any).status !== "terminated");
    if (!all.length) return null;
    return all[round % all.length]!.def.id;
  }
  return agents[round % agents.length]!.def.id;
}

function routeViaCapability<S extends Record<string, unknown>>(
  context:  Record<string, unknown>,
  registry: AgentRegistry<S>,
): string | null {
  const required = context.requiredCapabilities as string[] | undefined;
  if (!required || required.length === 0) return null;

  const all = registry.getAll().filter((a) => a.status !== "terminated");
  if (!all.length) return null;

  // Score each agent by how many required capabilities it matches
  let bestId: string | null = null;
  let bestScore = 0;

  for (const agent of all) {
    const capNames = new Set(agent.def.capabilities.map((c) => c.name.toLowerCase()));
    let score = 0;
    for (const req of required) {
      if (capNames.has(req.toLowerCase())) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestId = agent.def.id;
    }
  }

  return bestScore > 0 ? bestId : null;
}
