import { describe, it, expect } from "vitest";
import { SkillLoader } from "../harness/skill-loader.js";
import type { SkillDefinition } from "../harness/skill-loader.js";

function makeSkill(name: string): SkillDefinition {
  return {
    name,
    description: `Skill ${name}`,
    content: `Content for ${name}`,
    sourcePath: "programmatic",
  };
}

describe("BUG-0004: fork() isolates skill Map between original and fork", () => {
  it("BUG-0004: registering on fork should not mutate original", () => {
    const original = new SkillLoader();
    original.register(makeSkill("shared-skill"));

    const forked = original.fork();

    // Fork starts with the same skills
    expect(forked.get("shared-skill")).toBeDefined();

    // Register a new skill only on the fork
    forked.register(makeSkill("fork-only-skill"));

    // Fork has it
    expect(forked.get("fork-only-skill")).toBeDefined();
    expect(forked.getAll()).toHaveLength(2);

    // Original must NOT have the fork-only skill.
    // Before the fix, fork() assigned `forked.skills = this.skills` (shared reference),
    // so register() on the fork mutated the original's Map.
    expect(original.get("fork-only-skill")).toBeUndefined();
    expect(original.getAll()).toHaveLength(1);
  });
});
