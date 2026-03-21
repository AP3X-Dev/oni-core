// ============================================================
// @oni.bot/core/swarm/self-improvement — ExperimentLog
// Cumulative record of agent decisions and outcomes.
// Writes to the existing episodic memory tier.
// ============================================================

export interface ExperimentRecord {
  id: string;
  agentId: string;
  hypothesis: string;
  targetMetric: string;
  expectedDelta: number;
  metricBefore: number;
  metricAfter: number | null;
  success: boolean;
  /** Whether the metric should be minimized or maximized. Defaults to "minimize". */
  direction?: "minimize" | "maximize";
  contextSummary: string;
  timestamp: string;
}

export class ExperimentLog {
  private static readonly MAX_RECORDS = 1000;
  private records: ExperimentRecord[] = [];

  log(record: Omit<ExperimentRecord, "id" | "timestamp">): ExperimentRecord {
    const full: ExperimentRecord = {
      ...record,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };
    // Atomic reassignment: concurrent readers see the old snapshot while
    // the new array is built, preventing over-trim on concurrent calls.
    this.records = [...this.records, full].slice(-ExperimentLog.MAX_RECORDS);
    return full;
  }

  getHistory(agentId: string, limit = 50): ExperimentRecord[] {
    return this.records
      .filter(r => r.agentId === agentId)
      .slice(-limit);
  }

  getSuccessfulPatterns(agentId: string, metric: string): ExperimentRecord[] {
    return this.records.filter(
      r => r.agentId === agentId && r.targetMetric === metric && r.success
    );
  }

  /** Summarize recent history as a compact string for episodic memory */
  summarize(agentId: string, limit = 10): string {
    const history = this.getHistory(agentId, limit);
    if (history.length === 0) return "No experiments recorded.";
    const successRate = history.filter(r => r.success).length / history.length;
    const lines = history.map(r => {
      let delta: string;
      if (r.metricAfter !== null) {
        let d = r.metricAfter - r.metricBefore;
        if (r.direction === "minimize") d = -d;
        delta = d.toFixed(3);
      } else {
        delta = "n/a";
      }
      return `- [${r.success ? "+" : "x"}] ${r.hypothesis} (metric: ${r.targetMetric}, delta: ${delta})`;
    });
    return [
      `ExperimentLog (${history.length} recent, ${(successRate * 100).toFixed(0)}% success):`,
      ...lines,
    ].join("\n");
  }

  all(): ExperimentRecord[] {
    return [...this.records];
  }

  clear(): void {
    this.records.length = 0;
  }
}
