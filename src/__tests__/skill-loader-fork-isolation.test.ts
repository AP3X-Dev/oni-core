// Regression test for BUG-0004
// fork() previously assigned forked.skills = this.skills (shared Map reference),
// causing register() on either the original or fork to mutate both.
// Fix: fork() now uses new Map(this.skills) for an isolated shallow copy.

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

describe("BUG-0004: SkillLoader fork() isolation", () => {
  it("registering a skill on the fork does not affect the original", () => {
    const original = new SkillLoader();
    original.register(makeSkill("base-skill"));

    const forked = original.fork();
    forked.register(makeSkill("fork-only-skill"));

    // Original must NOT see the fork's new skill
    expect(original.get("fork-only-skill")).toBeUndefined();
    expect(original.getAll()).toHaveLength(1);
  });

  it("registering a skill on the original does not affect the fork", () => {
    const original = new SkillLoader();
    original.register(makeSkill("base-skill"));

    const forked = original.fork();
    original.register(makeSkill("original-only-skill"));

    // Fork must NOT see the original's new skill
    expect(forked.get("original-only-skill")).toBeUndefined();
    expect(forked.getAll()).toHaveLength(1);
  });

  it("fork inherits all skills that existed at fork time", () => {
    const original = new SkillLoader();
    original.register(makeSkill("skill-a"));
    original.register(makeSkill("skill-b"));

    const forked = original.fork();

    expect(forked.get("skill-a")).toBeDefined();
    expect(forked.get("skill-b")).toBeDefined();
    expect(forked.getAll()).toHaveLength(2);
  });

  it("concurrent forks are isolated from each other", () => {
    const original = new SkillLoader();
    original.register(makeSkill("shared-base"));

    const fork1 = original.fork();
    const fork2 = original.fork();

    fork1.register(makeSkill("fork1-skill"));
    fork2.register(makeSkill("fork2-skill"));

    expect(fork1.get("fork2-skill")).toBeUndefined();
    expect(fork2.get("fork1-skill")).toBeUndefined();
    expect(original.get("fork1-skill")).toBeUndefined();
    expect(original.get("fork2-skill")).toBeUndefined();
  });
});
