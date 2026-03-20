import type { TokenUsage } from "../models/types.js";
import type { BudgetConfig, AuditEntry } from "./types.js";

export class BudgetExceededError extends Error {
  constructor(
    public readonly kind: "agent" | "run" | "cost",
    public readonly current: number,
    public readonly limit: number,
  ) {
    super(
      kind === "cost"
        ? `Budget exceeded: cost $${current.toFixed(4)} exceeds limit $${limit.toFixed(4)}`
        : `Budget exceeded: ${current} tokens exceeds limit of ${limit} tokens (${kind})`,
    );
    this.name = "BudgetExceededError";
  }
}

/** Per-million-token pricing: [input, output] */
export interface ModelPricing {
  input: number;
  output: number;
}

/** Default pricing per million tokens for common models */
export const DEFAULT_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-6":      { input: 15.0, output: 75.0 },
  "claude-sonnet-4-6":    { input: 3.0,  output: 15.0 },
  "gpt-4o":               { input: 2.5,  output: 10.0 },
  "gpt-4o-mini":          { input: 0.15, output: 0.6 },
  "gemini-2.0-flash":     { input: 0.1,  output: 0.4 },
};

export class BudgetTracker {
  private agentTokens: Map<string, { input: number; output: number }> = new Map();
  private totalInput = 0;
  private totalOutput = 0;
  private totalCost = 0;
  private pricing: Record<string, ModelPricing>;
  private config: BudgetConfig;

  constructor(config: BudgetConfig, customPricing?: Record<string, ModelPricing>) {
    this.config = config;
    this.pricing = { ...DEFAULT_PRICING, ...customPricing };
  }

  record(agentName: string, modelId: string, usage: TokenUsage): AuditEntry[] {
    const entries: AuditEntry[] = [];

    // Update agent-level counters — atomic in-place mutation: initialise entry on
    // first access so the same object reference is always mutated (no read-then-set
    // window where a concurrent call could overwrite a sibling's increments).
    if (!this.agentTokens.has(agentName)) {
      this.agentTokens.set(agentName, { input: 0, output: 0 });
    }
    const existing = this.agentTokens.get(agentName)!;
    existing.input += usage.inputTokens;
    existing.output += usage.outputTokens;

    // Update run-level counters
    this.totalInput += usage.inputTokens;
    this.totalOutput += usage.outputTokens;

    // Calculate cost for this usage
    const pricing = this.pricing[modelId];
    if (pricing) {
      const cost =
        (usage.inputTokens / 1_000_000) * pricing.input +
        (usage.outputTokens / 1_000_000) * pricing.output;
      this.totalCost += cost;
    } else {
      console.warn(
        `[BudgetTracker] Unknown pricing for model "${modelId}"; cost tracking will be incomplete. ` +
        `maxCostPerRun limit may not be enforced.`,
      );
      entries.push({
        timestamp: Date.now(),
        agent: agentName,
        action: "budget.unknown_pricing",
        data: { modelId, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
      });
    }

    const now = Date.now();
    const agentTotal = existing.input + existing.output;
    const runTotal = this.totalInput + this.totalOutput;
    const mode = this.config.onBudgetExceeded ?? "error";

    // Check per-agent limit
    if (this.config.maxTokensPerAgent !== undefined) {
      const limit = this.config.maxTokensPerAgent;
      if (agentTotal > limit) {
        if (mode === "error") {
          throw new BudgetExceededError("agent", agentTotal, limit);
        }
        entries.push({
          timestamp: now,
          agent: agentName,
          action: "budget.exceeded",
          data: { kind: "agent", current: agentTotal, limit },
        });
      } else if (agentTotal >= limit * 0.8) {
        entries.push({
          timestamp: now,
          agent: agentName,
          action: "budget.warning",
          data: { kind: "agent", current: agentTotal, limit, percent: Math.round((agentTotal / limit) * 100) },
        });
      }
    }

    // Check per-run token limit
    if (this.config.maxTokensPerRun !== undefined) {
      const limit = this.config.maxTokensPerRun;
      if (runTotal > limit) {
        if (mode === "error") {
          throw new BudgetExceededError("run", runTotal, limit);
        }
        entries.push({
          timestamp: now,
          agent: agentName,
          action: "budget.exceeded",
          data: { kind: "run", current: runTotal, limit },
        });
      } else if (runTotal >= limit * 0.8) {
        entries.push({
          timestamp: now,
          agent: agentName,
          action: "budget.warning",
          data: { kind: "run", current: runTotal, limit, percent: Math.round((runTotal / limit) * 100) },
        });
      }
    }

    // Check cost limit
    if (this.config.maxCostPerRun !== undefined) {
      const limit = this.config.maxCostPerRun;
      if (this.totalCost > limit) {
        if (mode === "error") {
          throw new BudgetExceededError("cost", this.totalCost, limit);
        }
        entries.push({
          timestamp: now,
          agent: agentName,
          action: "budget.exceeded",
          data: { kind: "cost", current: this.totalCost, limit },
        });
      } else if (this.totalCost >= limit * 0.8) {
        entries.push({
          timestamp: now,
          agent: agentName,
          action: "budget.warning",
          data: { kind: "cost", current: this.totalCost, limit, percent: Math.round((this.totalCost / limit) * 100) },
        });
      }
    }

    return entries;
  }

  getAgentTokens(name: string): number {
    const entry = this.agentTokens.get(name);
    return entry ? entry.input + entry.output : 0;
  }

  getTotalTokens(): number {
    return this.totalInput + this.totalOutput;
  }

  getTotalCost(): number {
    return this.totalCost;
  }

  isOverBudget(): boolean {
    const runTotal = this.totalInput + this.totalOutput;

    if (this.config.maxTokensPerRun !== undefined && runTotal > this.config.maxTokensPerRun) {
      return true;
    }
    if (this.config.maxCostPerRun !== undefined && this.totalCost > this.config.maxCostPerRun) {
      return true;
    }
    if (this.config.maxTokensPerAgent !== undefined) {
      for (const [, entry] of this.agentTokens) {
        if (entry.input + entry.output > this.config.maxTokensPerAgent) {
          return true;
        }
      }
    }
    return false;
  }
}
