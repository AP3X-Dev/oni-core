// ============================================================
// @oni.bot/core/swarm/self-improvement — PatternLearner
// Pure functions — no state, no side effects.
// Identifies successful decision patterns from ExperimentLog.
// ============================================================

import type { ExperimentRecord } from "./experiment-log.js";

export interface Pattern {
  description: string;
  successRate: number;
  sampleSize: number;
  metricGain: number;
}

export interface DecisionContext {
  agentId: string;
  currentMetrics: Record<string, number>;
  taskDescription: string;
}

/**
 * Identify patterns from experiment history for a given metric.
 * Groups by hypothesis prefix words and calculates success rates.
 */
export function identifyPatterns(
  history: ExperimentRecord[],
  metric: string,
): Pattern[] {
  const relevant = history.filter(r => r.targetMetric === metric);
  if (relevant.length === 0) return [];

  // Group by first 3 words of hypothesis (simple heuristic)
  const groups = new Map<string, ExperimentRecord[]>();
  for (const record of relevant) {
    const key = record.hypothesis.split(" ").slice(0, 3).join(" ");
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }

  const patterns: Pattern[] = [];
  for (const [key, records] of groups) {
    if (records.length < 2) continue; // Need at least 2 samples
    const successes = records.filter(r => r.success);
    const successRate = successes.length / records.length;
    const gains = successes
      .filter(r => r.metricAfter !== null)
      .map(r => r.metricAfter! - r.metricBefore);
    const metricGain = gains.length > 0
      ? gains.reduce((a, b) => a + b, 0) / gains.length
      : 0;

    patterns.push({
      description: key,
      successRate,
      sampleSize: records.length,
      metricGain,
    });
  }

  return patterns.sort((a, b) => b.successRate - a.successRate);
}

/**
 * Suggest next experiments based on successful patterns and current context.
 */
export function suggestNext(
  context: DecisionContext,
  patterns: Pattern[],
): string[] {
  const topPatterns = patterns
    .filter(p => p.successRate >= 0.6 && p.sampleSize >= 2)
    .slice(0, 3);

  if (topPatterns.length === 0) {
    return ["No established patterns yet — explore new approaches"];
  }

  return topPatterns.map(p =>
    `Try pattern: "${p.description}" (success rate: ${(p.successRate * 100).toFixed(0)}%, avg gain: ${p.metricGain.toFixed(3)})`
  );
}
