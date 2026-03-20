import { describe, it, expect } from "vitest";
import { SkillEvolver } from "../../swarm/self-improvement/skill-evolver.js";

/**
 * Regression test for BUG-0271: commitOrRevert() validated content format
 * before calling safeSkillPath(), allowing a path-traversal skillName to
 * bypass the security check when the supplied content fails the format guard.
 *
 * Fix: safeSkillPath() is now called BEFORE content format checks, so
 * "../../etc/passwd" style skill names always throw "Path traversal detected"
 * regardless of the content format.
 */
describe("BUG-0271: commitOrRevert path-traversal guard fires before content format check", () => {
  const skillsRoot = "/tmp/oni-test-skills-bug271";

  const baseExperiment = {
    hypothesis: "improve this",
    success: true,
    metricBefore: 1.0,
    metricAfter: 0.5,
    rolledBack: false,
    reason: "metric improved",
  };

  it("BUG-0271: rejects path traversal even when content is invalid format (does not start with # or ---)", async () => {
    // Before the fix: content that doesn't start with '#' or '---' caused an
    // early return before safeSkillPath() was called — path traversal slipped through.
    // After the fix: safeSkillPath() fires first regardless of content format.
    const evolver = new SkillEvolver({ skillsRoot });

    await expect(
      evolver.commitOrRevert("../../etc/passwd", baseExperiment, "malicious content without heading"),
    ).rejects.toThrow(/path traversal/i);
  });

  it("BUG-0271: rejects path traversal when content is non-empty but has no markdown heading (the pre-fix bypass vector)", async () => {
    // The original bug: content that doesn't start with '#' or '---' caused
    // an early return at the format check, BEFORE safeSkillPath() was called.
    // An attacker could supply non-empty, non-markdown content to bypass the
    // path traversal guard. After the fix, safeSkillPath() runs first.
    const evolver = new SkillEvolver({ skillsRoot });

    // Non-empty content that doesn't start with '#' or '---'
    // Before the fix: format check returned early, traversal bypassed
    // After the fix: traversal guard fires first, throws
    await expect(
      evolver.commitOrRevert("../escape", baseExperiment, "injected content without heading"),
    ).rejects.toThrow(/path traversal/i);
  });

  it("BUG-0271: rejects path traversal even when content is valid markdown format", async () => {
    // Regardless of content validity, traversal paths must be blocked
    const evolver = new SkillEvolver({ skillsRoot });

    await expect(
      evolver.commitOrRevert("../../some/path", baseExperiment, "# Valid markdown heading\nsome content"),
    ).rejects.toThrow(/path traversal/i);
  });

  it("BUG-0271: valid skill name with invalid content format returns without error (content guard is not a throw)", async () => {
    // When the skill name is safe, the content format check applies but returns
    // early (does not throw). This verifies the content check is not confused with
    // path traversal — only path traversal throws.
    const evolver = new SkillEvolver({ skillsRoot });

    // Invalid format content, safe skill name → resolves (returns early, no throw)
    await expect(
      evolver.commitOrRevert("my-skill", baseExperiment, "content without heading"),
    ).resolves.toBeUndefined();
  });

  it("BUG-0271: valid skill name with valid content resolves without error (would write file)", async () => {
    // A successful=false experiment returns early without writing — safe to test
    const evolver = new SkillEvolver({ skillsRoot });

    const failedExperiment = {
      ...baseExperiment,
      success: false,
      rolledBack: true,
      reason: "no improvement",
    };

    await expect(
      evolver.commitOrRevert("my-skill", failedExperiment, "# Valid content"),
    ).resolves.toBeUndefined();
  });
});
