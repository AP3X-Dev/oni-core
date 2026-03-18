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
  /** Whether the metric should be minimized or maximized. Defaults to "minimize". */
  direction?: "minimize" | "maximize";
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
    const { checkpointer, threadId, hypothesis, applyChanges, measureMetric, timeBudget, threshold, direction = "minimize" } = opts;

    // Measure baseline
    let metricBefore: number;
    const baselineTimeout = this._timeout(timeBudget, "Baseline measurement timed out");
    try {
      metricBefore = await Promise.race([
        measureMetric(),
        baselineTimeout.promise,
      ]);
    } catch (err) {
      return { hypothesis, success: false, metricBefore: 0, metricAfter: null, rolledBack: false, reason: String(err) };
    } finally {
      baselineTimeout.clear();
    }

    // Snapshot
    const snapshot = await checkpointer.get(threadId);

    // Apply changes
    const applyTimeout = this._timeout(timeBudget, "applyChanges timed out");
    try {
      await Promise.race([
        applyChanges(),
        applyTimeout.promise,
      ]);
    } catch (err) {
      await this._rollback(checkpointer, threadId, snapshot);
      return { hypothesis, success: false, metricBefore, metricAfter: null, rolledBack: true, reason: `applyChanges failed: ${String(err)}` };
    } finally {
      applyTimeout.clear();
    }

    // Measure result
    let metricAfter: number;
    const measureTimeout = this._timeout(timeBudget, "Post-experiment measurement timed out");
    try {
      metricAfter = await Promise.race([
        measureMetric(),
        measureTimeout.promise,
      ]);
    } catch (err) {
      // Roll back on measurement failure
      await this._rollback(checkpointer, threadId, snapshot);
      return { hypothesis, success: false, metricBefore, metricAfter: null, rolledBack: true, reason: `Measurement failed: ${String(err)}` };
    } finally {
      measureTimeout.clear();
    }

    // Check improvement based on direction
    const improved = direction === "maximize"
      ? metricAfter - metricBefore >= threshold
      : metricBefore - metricAfter >= threshold;
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
    threadId: string,
    snapshot: ONICheckpoint<S> | null,
  ): Promise<void> {
    if (!snapshot) return;
    try {
      // Remove ALL checkpoints for this thread (including higher-step ones
      // written during measureMetric) so the restored snapshot becomes the
      // latest checkpoint returned by get().
      await checkpointer.delete(threadId);
      await checkpointer.put(snapshot);
    } catch {
      // Rollback failure is non-fatal — log but don't throw
    }
  }

  private _timeout(ms: number, message: string): { promise: Promise<never>; clear: () => void } {
    let timer: ReturnType<typeof setTimeout>;
    const promise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return { promise, clear: () => clearTimeout(timer) };
  }
}
