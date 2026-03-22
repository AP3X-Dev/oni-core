import { describe, it, expect, vi } from "vitest";
import { SkillEvolver } from "../../swarm/self-improvement/skill-evolver.js";

/**
 * Regression tests for BUG-0431: testSkillRevision() awaited the user-supplied
 * testFn callback without a try/catch. A throwing testFn produced an unhandled
 * promise rejection that aborted the entire self-improvement cycle.
 *
 * Fix: wrap the testFn call in try/catch. On throw, return a valid ExperimentResult
 * with success:false and a reason describing the error, so the improvement loop
 * continues gracefully rather than crashing.
 */
describe("BUG-0431: testSkillRevision() handles throwing testFn without crashing", () => {
  it("BUG-0431: returns a failed ExperimentResult when testFn throws synchronously", async () => {
    const evolver = new SkillEvolver({});

    const throwingTestFn = vi.fn().mockImplementation(() => {
      throw new Error("test harness crashed");
    });

    const result = await evolver.testSkillRevision(
      "my-skill",
      "# my-skill\nImproved content.",
      "solve a problem",
      throwingTestFn,
    );

    // Must resolve (not throw / unhandled rejection)
    expect(result).toBeDefined();
    expect(result.success).toBe(false);
    expect(result.rolledBack).toBe(false);
    expect(result.metricAfter).toBeNull();
    expect(result.reason).toMatch(/test harness crashed/);
    expect(throwingTestFn).toHaveBeenCalledOnce();
  });

  it("BUG-0431: returns a failed ExperimentResult when testFn rejects with an Error", async () => {
    const evolver = new SkillEvolver({});

    const rejectingTestFn = vi.fn().mockRejectedValue(new Error("async failure in testFn"));

    const result = await evolver.testSkillRevision(
      "skill-async",
      "# skill-async\nRevised.",
      "do async work",
      rejectingTestFn,
    );

    expect(result).toBeDefined();
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/async failure in testFn/);
  });

  it("BUG-0431: returns a failed ExperimentResult when testFn rejects with a non-Error value", async () => {
    const evolver = new SkillEvolver({});

    // eslint-disable-next-line prefer-promise-reject-errors
    const rejectingTestFn = vi.fn().mockRejectedValue("string rejection");

    const result = await evolver.testSkillRevision(
      "skill-string-err",
      "# skill-string-err\nContent.",
      "task",
      rejectingTestFn,
    );

    expect(result).toBeDefined();
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/string rejection/);
  });

  it("BUG-0431: ExperimentResult from a throwing testFn has all required fields", async () => {
    const evolver = new SkillEvolver({});

    const throwingTestFn = vi.fn().mockRejectedValue(new Error("boom"));

    const result = await evolver.testSkillRevision(
      "full-fields-skill",
      "content",
      "test task",
      throwingTestFn,
    );

    // All 6 ExperimentResult fields must be present and correctly typed
    expect(typeof result.hypothesis).toBe("string");
    expect(result.hypothesis).toContain("full-fields-skill");
    expect(result.success).toBe(false);
    expect(typeof result.metricBefore).toBe("number");
    expect(result.metricAfter).toBeNull();
    expect(result.rolledBack).toBe(false);
    expect(typeof result.reason).toBe("string");
  });

  it("BUG-0431: successful testFn result is passed through unchanged", async () => {
    const evolver = new SkillEvolver({});

    const successResult = {
      hypothesis: "custom hypothesis",
      success: true,
      metricBefore: 0.6,
      metricAfter: 0.9,
      rolledBack: false,
      reason: "improvement confirmed",
    };
    const successTestFn = vi.fn().mockResolvedValue(successResult);

    const result = await evolver.testSkillRevision(
      "good-skill",
      "content",
      "task",
      successTestFn,
    );

    expect(result).toEqual(successResult);
  });
});
