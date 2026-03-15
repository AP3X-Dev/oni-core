// ============================================================
// @oni.bot/core/harness/loop — ExperimentalExecutor
// Reversibility mechanism for self-improvement experiments.
// Wraps ONICheckpointer for checkpoint-before/rollback-on-regression.
// ============================================================

import type { ONICheckpointer, ONICheckpoint } from "../../types.js";

export interface ExperimentOptions<S> {
  checkpointer: ONICheckpointer<S>;
  threadId: string;
  hypothesis: string;
  applyChanges: () => Promise<void>;
  measureMetric: () => Promise<number>;
  timeBudget: number;
  threshold: number;
}

export interface ExperimentResult {
  hypothesis: string;
  success: boolean;
  metricBefore: number;
  metricAfter: number | null;
  rolledBack: boolean;
  reason: string;
}

export class ExperimentalExecutor {
  /**
   * Run an experiment with automatic rollback if the metric regresses.
   *
   * 1. Snapshot current checkpoint
   * 2. Apply proposed changes
   * 3. Measure metric
   * 4. If improved by >= threshold: keep changes
   * 5. If regressed: restore checkpoint
   */
  async runExperiment<S>(opts: ExperimentOptions<S>): Promise<ExperimentResult> {
    const { checkpointer, threadId, hypothesis, applyChanges, measureMetric, timeBudget, threshold } = opts;

    // Measure baseline
    let metricBefore: number;
    try {
      metricBefore = await Promise.race([
        measureMetric(),
        this._timeout(timeBudget, "Baseline measurement timed out"),
      ]);
    } catch (err) {
      return { hypothesis, success: false, metricBefore: 0, metricAfter: null, rolledBack: false, reason: String(err) };
    }

    // Snapshot
    const snapshot = await checkpointer.get(threadId);

    // Apply changes
    try {
      await Promise.race([
        applyChanges(),
        this._timeout(timeBudget, "applyChanges timed out"),
      ]);
    } catch (err) {
      return { hypothesis, success: false, metricBefore, metricAfter: null, rolledBack: false, reason: `applyChanges failed: ${String(err)}` };
    }

    // Measure result
    let metricAfter: number;
    try {
      metricAfter = await Promise.race([
        measureMetric(),
        this._timeout(timeBudget, "Post-experiment measurement timed out"),
      ]);
    } catch (err) {
      // Roll back on measurement failure
      await this._rollback(checkpointer, threadId, snapshot);
      return { hypothesis, success: false, metricBefore, metricAfter: null, rolledBack: true, reason: `Measurement failed: ${String(err)}` };
    }

    // Improvement means the metric decreased by at least threshold (lower = better)
    const improved = metricBefore - metricAfter >= threshold;
    if (!improved) {
      await this._rollback(checkpointer, threadId, snapshot);
      return {
        hypothesis,
        success: false,
        metricBefore,
        metricAfter,
        rolledBack: true,
        reason: `Metric did not improve by threshold (${threshold}): ${metricBefore} -> ${metricAfter}`,
      };
    }

    return {
      hypothesis,
      success: true,
      metricBefore,
      metricAfter,
      rolledBack: false,
      reason: `Improved: ${metricBefore} -> ${metricAfter}`,
    };
  }

  private async _rollback<S>(
    checkpointer: ONICheckpointer<S>,
    _threadId: string,
    snapshot: ONICheckpoint<S> | null,
  ): Promise<void> {
    if (!snapshot) return;
    try {
      await checkpointer.put(snapshot);
    } catch {
      // Rollback failure is non-fatal — log but don't throw
    }
  }

  private _timeout(ms: number, message: string): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms)
    );
  }
}
