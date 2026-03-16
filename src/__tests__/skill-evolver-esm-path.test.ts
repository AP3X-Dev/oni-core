import { describe, it, expect } from "vitest";
import { SkillEvolver } from "../swarm/self-improvement/skill-evolver.js";

describe("SkillEvolver", () => {
  it("BUG-0078: safeSkillPath does not throw ReferenceError from require() in ESM", async () => {
    const evolver = new SkillEvolver({ skillsRoot: "/tmp/oni-test-skills" });

    // safeSkillPath is called internally by commitOrRevert.
    // Before the fix, require("node:path") threw ReferenceError in ESM,
    // making all path-traversal checks unreachable.
    // A path traversal attempt should throw a descriptive Error, not ReferenceError.
    const fakeResult = {
      hypothesis: "test",
      success: true,
      metricBefore: 0,
      metricAfter: 0,
      rolledBack: false,
      reason: "test",
    };

    await expect(
      evolver.commitOrRevert("../../etc/passwd", fakeResult, "malicious content"),
    ).rejects.toThrow("Path traversal detected");

    // Also verify it does NOT throw ReferenceError
    await expect(
      evolver.commitOrRevert("../../etc/passwd", fakeResult, "malicious content"),
    ).rejects.not.toThrow(ReferenceError);
  });
});
