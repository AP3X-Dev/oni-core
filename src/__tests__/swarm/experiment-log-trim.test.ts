import { describe, it, expect } from "vitest";
import { ExperimentLog } from "../../swarm/self-improvement/experiment-log.js";

/**
 * Regression test for BUG-0395: ExperimentLog.log() performs a non-atomic
 * push+splice on this.records. When multiple log() calls fire concurrently
 * (concurrent agents sharing one ExperimentLog instance), both calls can
 * observe records.length > MAX_RECORDS after their respective pushes and
 * both splice, over-trimming and losing valid recent entries.
 *
 * The fix is to replace the mutable splice with a slice reassignment that
 * operates on the already-modified array, preventing double-trim.
 *
 * This test guards against regression: after log() is called MAX_RECORDS+N
 * times, records must be exactly MAX_RECORDS (no over-trimming or under-trimming).
 */

const MAX_RECORDS = 1000; // matches ExperimentLog.MAX_RECORDS

function makeRecord(i: number) {
  return {
    agentId:        `agent-${i % 5}`,
    hypothesis:     `hypothesis-${i}`,
    targetMetric:   "latency",
    expectedDelta:  -0.1,
    metricBefore:   1.0,
    metricAfter:    0.9,
    success:        true,
    contextSummary: `ctx-${i}`,
  };
}

describe("BUG-0395: ExperimentLog trim does not over-trim on sequential calls", () => {
  it("after exactly MAX_RECORDS log() calls, records.length === MAX_RECORDS", () => {
    const log = new ExperimentLog();
    for (let i = 0; i < MAX_RECORDS; i++) {
      log.log(makeRecord(i));
    }
    expect(log.all().length).toBe(MAX_RECORDS);
  });

  it("after MAX_RECORDS + 1 calls, records.length === MAX_RECORDS (oldest evicted)", () => {
    const log = new ExperimentLog();
    for (let i = 0; i < MAX_RECORDS + 1; i++) {
      log.log(makeRecord(i));
    }
    const records = log.all();
    expect(records.length).toBe(MAX_RECORDS);
    // The oldest entry (i=0) must have been evicted
    expect(records[0].hypothesis).toBe("hypothesis-1");
    // The newest must still be present
    expect(records[records.length - 1].hypothesis).toBe(`hypothesis-${MAX_RECORDS}`);
  });

  it("after MAX_RECORDS + 50 calls, records.length === MAX_RECORDS (no over-trim)", () => {
    const log = new ExperimentLog();
    for (let i = 0; i < MAX_RECORDS + 50; i++) {
      log.log(makeRecord(i));
    }
    const records = log.all();
    // Exactly MAX_RECORDS — not fewer (no over-trim due to double-splice)
    expect(records.length).toBe(MAX_RECORDS);
    // Most recent 1000 entries are preserved
    expect(records[0].hypothesis).toBe("hypothesis-50");
    expect(records[records.length - 1].hypothesis).toBe(`hypothesis-${MAX_RECORDS + 49}`);
  });

  it("getHistory() returns correct recent entries after trimming", () => {
    const log = new ExperimentLog();
    for (let i = 0; i < MAX_RECORDS + 10; i++) {
      log.log(makeRecord(i));
    }
    // agent-0 appears at indices 0, 5, 10, ... of the original sequence
    // After trimming, agent-0's entries from i=10 onward should be accessible
    const history = log.getHistory("agent-0", 50);
    // All returned entries must be for agent-0
    expect(history.every(r => r.agentId === "agent-0")).toBe(true);
  });

  it("clear() resets records to empty", () => {
    const log = new ExperimentLog();
    for (let i = 0; i < 5; i++) {
      log.log(makeRecord(i));
    }
    log.clear();
    expect(log.all().length).toBe(0);
    // Can add new records after clear
    log.log(makeRecord(999));
    expect(log.all().length).toBe(1);
  });
});
