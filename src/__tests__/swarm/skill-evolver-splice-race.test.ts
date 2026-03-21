import { describe, it, expect, vi } from "vitest";
import { SkillEvolver } from "../../swarm/self-improvement/skill-evolver.js";

/**
 * Regression tests for BUG-0350: recordSkillUsage uses splice() to evict old
 * entries from usageHistory. When identifyWeakSkills (which iterates via
 * for...of) runs while splice evicts, the array mutation shifts indices and
 * the iterator skips entries — producing incorrect performance reports.
 *
 * Similarly, proposeSkillImprovement filters usageHistory after an await, at
 * which point a concurrent recordSkillUsage call may have spliced the array,
 * causing the LLM to receive an incomplete failure list.
 *
 * Fix: replace splice with an atomic slice reassignment so any concurrent
 * reader holds a stable reference to the pre-eviction array.
 */
describe("BUG-0350: recordSkillUsage eviction does not corrupt concurrent reads", () => {
  it("BUG-0350: identifyWeakSkills reports correct usageCount after eviction at exactly MAX_USAGE_HISTORY+1", () => {
    // Fill usageHistory to exactly 1000 entries (the cap).
    // The next recordSkillUsage must trigger eviction.
    // After eviction the total must still be exactly 1000, not 999 or 1001.
    const evolver = new SkillEvolver({ minSamples: 1, weaknessThreshold: 1.0 });

    for (let i = 0; i < 1000; i++) {
      evolver.recordSkillUsage("skill-a", "failure", `ctx-${i}`);
    }

    // This call pushes to 1001, triggering the splice/slice eviction back to 1000.
    evolver.recordSkillUsage("skill-a", "failure", "ctx-1000");

    const reports = evolver.identifyWeakSkills(1.0);
    const report = reports.find(r => r.skillName === "skill-a");

    expect(report).toBeDefined();
    // After eviction usageCount must equal exactly MAX_USAGE_HISTORY (1000).
    // With a buggy splice that over-removes, this would be < 1000.
    expect(report!.usageCount).toBe(1000);
  });

  it("BUG-0350: identifyWeakSkills does not under-count after repeated evictions", () => {
    // Simulate multiple eviction cycles: add 1200 entries for two skills,
    // causing repeated evictions. Each skill's ratio must be accurately tracked.
    const evolver = new SkillEvolver({ minSamples: 1, weaknessThreshold: 1.0 });

    // Add 600 successes then 600 failures across two skills (interleaved).
    // This exceeds MAX_USAGE_HISTORY and triggers multiple evictions.
    for (let i = 0; i < 600; i++) {
      evolver.recordSkillUsage("skill-x", "success", `s${i}`);
      evolver.recordSkillUsage("skill-y", "failure", `f${i}`);
    }

    const reports = evolver.identifyWeakSkills(1.0);
    // skill-x has 100% success — should not appear in the weak list
    const reportX = reports.find(r => r.skillName === "skill-x");
    // skill-y has 100% failure — should appear in the weak list
    const reportY = reports.find(r => r.skillName === "skill-y");

    expect(reportX).toBeUndefined();
    expect(reportY).toBeDefined();
    // Total history is capped at 1000; after 1200 interleaved records the
    // cap evicts the earliest 200 entries. The remaining 1000 entries are
    // 500 skill-x successes + 500 skill-y failures.
    expect(reportY!.usageCount).toBe(500);
    expect(reportY!.successRate).toBe(0);
  });

  it("BUG-0350: proposeSkillImprovement receives non-empty failure context after eviction occurs during await", async () => {
    // Reproduce the async race: fill history near the cap for "skill-z" with
    // failures, then trigger eviction mid-way through proposeSkillImprovement
    // by calling recordSkillUsage from inside the mocked llm.chat().
    //
    // With splice: the eviction mutates the array that proposeSkillImprovement's
    // .filter() call will read, potentially truncating the failure list.
    // With slice reassignment: the filter runs on a stable snapshot.
    const evolver = new SkillEvolver({ minSamples: 1, weaknessThreshold: 0.5 });

    // Record 995 failures for skill-z (just under the 1000-entry cap).
    for (let i = 0; i < 995; i++) {
      evolver.recordSkillUsage("skill-z", "failure", `fail-${i}`);
    }

    // The mocked llm.chat triggers eviction synchronously before returning —
    // this simulates what happens when the event loop yields between the two
    // awaits in proposeSkillImprovement and recordSkillUsage fires.
    let capturedMessages: Array<{ role: string; content: string }> = [];
    const llm = {
      chat: vi.fn().mockImplementation(async (opts: { messages: Array<{ role: string; content: string }> }) => {
        // Simulate concurrent recordSkillUsage calls that push over the cap.
        for (let i = 0; i < 10; i++) {
          evolver.recordSkillUsage("skill-z", "failure", `concurrent-${i}`);
        }
        capturedMessages = opts.messages;
        return { content: "# skill-z\n\nImproved." };
      }),
    };

    const result = await evolver.proposeSkillImprovement("skill-z", llm);

    // The proposal must be returned (not null)
    expect(result).toBe("# skill-z\n\nImproved.");

    // The failure context passed to the LLM must be non-empty — the filter
    // should see skill-z failures regardless of eviction.
    expect(capturedMessages.length).toBeGreaterThan(0);
    const userMessage = capturedMessages[0].content;
    // The message should list at least some recent failure contexts
    expect(userMessage).not.toContain("(none)");
  });

  it("BUG-0350: recentFailures in identifyWeakSkills report are consistent after eviction", () => {
    // After eviction the recentFailures list must contain only entries that
    // belong to the retained tail of usageHistory — not stale/undefined slots.
    const evolver = new SkillEvolver({ minSamples: 1, weaknessThreshold: 1.0 });

    // Add 1050 failures to force eviction (50 entries trimmed).
    for (let i = 0; i < 1050; i++) {
      evolver.recordSkillUsage("skill-w", "failure", `ctx-${i}`);
    }

    const reports = evolver.identifyWeakSkills(1.0);
    const report = reports.find(r => r.skillName === "skill-w");

    expect(report).toBeDefined();
    // recentFailures returns the last 5 failures; all must be defined and valid
    expect(report!.recentFailures.length).toBe(5);
    for (const rec of report!.recentFailures) {
      expect(rec).toBeDefined();
      expect(rec.skillName).toBe("skill-w");
      expect(rec.outcome).toBe("failure");
      expect(typeof rec.context).toBe("string");
      // After evicting the first 50 entries, valid contexts start at ctx-50
      // The last 5 failures are ctx-1045 through ctx-1049
      expect(rec.context).toMatch(/^ctx-\d+$/);
    }
    // Verify the last 5 are the most recent
    const contexts = report!.recentFailures.map(r => r.context);
    expect(contexts).toEqual(["ctx-1045", "ctx-1046", "ctx-1047", "ctx-1048", "ctx-1049"]);
  });
});
