import { describe, it, expect, vi } from "vitest";
import { SkillEvolver } from "../swarm/self-improvement/skill-evolver.js";

describe("BUG-0238: proposeSkillImprovement handles llm.chat() failures gracefully", () => {
  it("BUG-0238: should return null instead of throwing when llm.chat() rejects", async () => {
    const evolver = new SkillEvolver({ minSamples: 1, weaknessThreshold: 1.0 });

    const failingLlm = {
      chat: vi.fn().mockRejectedValue(new Error("Network error: 429 Too Many Requests")),
    };

    // Before the fix, this would propagate as an unhandled rejection.
    // After the fix, it must return null gracefully.
    const result = await evolver.proposeSkillImprovement("my-skill", failingLlm);

    expect(result).toBeNull();
    expect(failingLlm.chat).toHaveBeenCalledOnce();
  });

  it("BUG-0238: should return the proposal string when llm.chat() succeeds", async () => {
    const evolver = new SkillEvolver({ minSamples: 1, weaknessThreshold: 1.0 });

    const successLlm = {
      chat: vi.fn().mockResolvedValue({ content: "# my-skill\n\nImproved content." }),
    };

    const result = await evolver.proposeSkillImprovement("my-skill", successLlm);

    expect(result).toBe("# my-skill\n\nImproved content.");
  });
});
