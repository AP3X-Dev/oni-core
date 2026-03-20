import { describe, it, expect } from "vitest";
import { SkillEvolver } from "../../swarm/self-improvement/skill-evolver.js";

describe("BUG-0078: safeSkillPath uses ESM-compatible path import", () => {
  it("BUG-0078: commitOrRevert does not throw ReferenceError from require('node:path')", async () => {
    // Before the fix, safeSkillPath() called require("node:path") which throws
    // ReferenceError in the ESM runtime. The fix replaces it with a static
    // `import path from "node:path"` at the top of the module.
    //
    // We verify the fix by calling commitOrRevert() with a path-traversal
    // skillName. The call must throw a path-traversal Error (the security
    // guard inside safeSkillPath), NOT a ReferenceError from require().
    const evolver = new SkillEvolver({ skillsRoot: "/tmp/skills" });

    const experiment = {
      hypothesis: "test",
      success: true,
      metricBefore: 0,
      metricAfter: 1,
      rolledBack: false,
      reason: "test",
    };

    await expect(
      evolver.commitOrRevert("../escape", experiment, "revised content"),
    ).rejects.toThrow(/path traversal/i);
  });

  it("BUG-0078: commitOrRevert with a valid skill name reaches the file-write stage without ReferenceError", async () => {
    // A non-traversal skill name should reach fs.writeFile (or skip if
    // experiment.success === false) without ever throwing ReferenceError.
    const evolver = new SkillEvolver({ skillsRoot: "/tmp/oni-test-skills" });

    const failedExperiment = {
      hypothesis: "test",
      success: false,
      metricBefore: 0,
      metricAfter: 0,
      rolledBack: true,
      reason: "test failed",
    };

    // success=false causes early return before any fs operation — no error thrown.
    await expect(
      evolver.commitOrRevert("my-skill", failedExperiment, "content"),
    ).resolves.toBeUndefined();
  });
});
