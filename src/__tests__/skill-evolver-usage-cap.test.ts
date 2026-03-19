import { describe, it, expect } from "vitest";
import { SkillEvolver } from "../swarm/self-improvement/skill-evolver.js";

describe("BUG-0015: usageHistory is capped at MAX_USAGE_HISTORY", () => {
  it("BUG-0015: should evict oldest entries when usageHistory exceeds 1000", () => {
    const evolver = new SkillEvolver({ minSamples: 1, weaknessThreshold: 1.0 });

    // Record 1050 failures for the same skill
    for (let i = 0; i < 1050; i++) {
      evolver.recordSkillUsage("test-skill", "failure", `ctx-${i}`);
    }

    // identifyWeakSkills reports usageCount from the internal array.
    // Before the fix, usageCount would be 1050 (unbounded growth).
    // After the fix, it should be capped at 1000.
    const reports = evolver.identifyWeakSkills();
    const report = reports.find(r => r.skillName === "test-skill");

    expect(report).toBeDefined();
    expect(report!.usageCount).toBeLessThanOrEqual(1000);
  });
});
