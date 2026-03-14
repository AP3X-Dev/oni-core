import { describe, it, expect } from "vitest";
import { BudgetTracker, BudgetExceededError } from "../guardrails/budget.js";
import type { TokenUsage } from "../models/types.js";

describe("guardrails — budget tracker", () => {
  const usage = (input: number, output: number): TokenUsage => ({ inputTokens: input, outputTokens: output });

  it("tracks total tokens across agents", () => {
    const tracker = new BudgetTracker({});

    tracker.record("agent-a", "gpt-4o", usage(100, 50));
    tracker.record("agent-b", "gpt-4o", usage(200, 100));

    expect(tracker.getTotalTokens()).toBe(450);
    expect(tracker.getAgentTokens("agent-a")).toBe(150);
    expect(tracker.getAgentTokens("agent-b")).toBe(300);
  });

  it("tracks cost using pricing table", () => {
    const tracker = new BudgetTracker({});

    // gpt-4o: input $2.5/M, output $10.0/M
    tracker.record("agent-a", "gpt-4o", usage(1_000_000, 0));
    expect(tracker.getTotalCost()).toBeCloseTo(2.5, 2);

    tracker.record("agent-a", "gpt-4o", usage(0, 1_000_000));
    expect(tracker.getTotalCost()).toBeCloseTo(12.5, 2);
  });

  it("throws BudgetExceededError when onBudgetExceeded is error", () => {
    const tracker = new BudgetTracker({
      maxTokensPerRun: 500,
      onBudgetExceeded: "error",
    });

    // Under limit — no throw
    tracker.record("agent-a", "gpt-4o", usage(200, 100));
    expect(tracker.getTotalTokens()).toBe(300);

    // Over limit — throws
    expect(() => tracker.record("agent-a", "gpt-4o", usage(200, 100))).toThrow(BudgetExceededError);

    try {
      // Reset to new tracker to test error properties
      const t2 = new BudgetTracker({ maxTokensPerRun: 100, onBudgetExceeded: "error" });
      t2.record("a", "gpt-4o", usage(80, 80));
    } catch (e) {
      expect(e).toBeInstanceOf(BudgetExceededError);
      expect((e as BudgetExceededError).kind).toBe("run");
      expect((e as BudgetExceededError).current).toBe(160);
      expect((e as BudgetExceededError).limit).toBe(100);
    }
  });

  it("returns warning entries at 80% usage", () => {
    const tracker = new BudgetTracker({
      maxTokensPerRun: 1000,
      onBudgetExceeded: "warn",
    });

    // 70% — no warnings
    const entries1 = tracker.record("agent-a", "gpt-4o", usage(350, 350));
    expect(entries1).toEqual([]);

    // Now at 850/1000 = 85% — should get warning
    const entries2 = tracker.record("agent-a", "gpt-4o", usage(100, 50));
    expect(entries2.length).toBeGreaterThanOrEqual(1);
    expect(entries2.some(e => e.action === "budget.warning")).toBe(true);
  });

  it("returns exceeded entries with warn mode", () => {
    const tracker = new BudgetTracker({
      maxTokensPerRun: 500,
      onBudgetExceeded: "warn",
    });

    tracker.record("agent-a", "gpt-4o", usage(200, 100));

    // Over limit with warn mode — should NOT throw, should return exceeded entries
    const entries = tracker.record("agent-a", "gpt-4o", usage(200, 100));
    expect(entries.some(e => e.action === "budget.exceeded")).toBe(true);
  });

  it("tracks per-agent limits", () => {
    const tracker = new BudgetTracker({
      maxTokensPerAgent: 300,
      onBudgetExceeded: "error",
    });

    // agent-a at 250 — under limit
    tracker.record("agent-a", "gpt-4o", usage(125, 125));

    // agent-b at 200 — under limit
    tracker.record("agent-b", "gpt-4o", usage(100, 100));

    // agent-a at 500 — over limit
    expect(() => tracker.record("agent-a", "gpt-4o", usage(125, 125))).toThrow(BudgetExceededError);

    // agent-b still under limit
    expect(() => tracker.record("agent-b", "gpt-4o", usage(50, 50))).not.toThrow();
  });

  it("isOverBudget returns true when exceeded", () => {
    const tracker = new BudgetTracker({
      maxTokensPerRun: 500,
      onBudgetExceeded: "warn",
    });

    tracker.record("agent-a", "gpt-4o", usage(200, 100));
    expect(tracker.isOverBudget()).toBe(false);

    tracker.record("agent-a", "gpt-4o", usage(200, 100));
    expect(tracker.isOverBudget()).toBe(true);
  });
});
