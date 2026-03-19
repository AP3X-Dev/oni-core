import { describe, it, expect, vi } from "vitest";
import { SkillEvolver } from "../swarm/self-improvement/skill-evolver.js";

describe("SkillEvolver", () => {
  it("BUG-0238: proposeSkillImprovement returns null on llm.chat failure instead of throwing", async () => {
    const evolver = new SkillEvolver({ minSamples: 1 });

    // Record enough failures so the skill has usage history
    evolver.recordSkillUsage("test-skill", "failure", "test context");

    const llm = {
      chat: vi.fn().mockRejectedValue(new Error("API rate limit exceeded (429)")),
    };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await evolver.proposeSkillImprovement("test-skill", llm);

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("llm.chat failed"),
      expect.any(Error),
    );

    warnSpy.mockRestore();
  });
});
