// ============================================================
// SkillLoader runtime policy hook — scoped skill file loading
// ============================================================

import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SkillLoader, type SkillLoaderPolicyLike } from "../harness/skill-loader.js";

const SKILL = `---
name: scoped-skill
description: A skill behind a policy
---
Body.
`;

/** Allow only paths inside `root`; otherwise throw like a real RuntimePolicy. */
function policyFor(root: string): SkillLoaderPolicyLike {
  return {
    assertPathAllowed(path: string): string {
      if (!path.startsWith(root)) {
        throw new Error(`Path access denied: ${path}`);
      }
      return path;
    },
  };
}

const denyAll: SkillLoaderPolicyLike = {
  assertPathAllowed(path: string): string {
    throw new Error(`Path access denied: ${path}`);
  },
};

describe("SkillLoader runtime policy", () => {
  it("loads skills when the policy allows the directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "oni-skill-policy-allow-"));
    try {
      writeFileSync(join(dir, "SKILL.md"), SKILL, "utf-8");
      const loader = SkillLoader.fromDirectory(dir, { runtimePolicy: policyFor(dir) });
      expect(loader.get("scoped-skill")).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("silently skips skills outside the allowed scope during a directory scan", () => {
    const dir = mkdtempSync(join(tmpdir(), "oni-skill-policy-deny-"));
    try {
      writeFileSync(join(dir, "SKILL.md"), SKILL, "utf-8");
      const loader = SkillLoader.fromDirectory(dir, { runtimePolicy: denyAll });
      expect(loader.getAll().length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws on an explicit single-file load that the policy denies", () => {
    const dir = mkdtempSync(join(tmpdir(), "oni-skill-policy-explicit-"));
    try {
      const file = join(dir, "SKILL.md");
      writeFileSync(file, SKILL, "utf-8");
      const loader = new SkillLoader({ runtimePolicy: denyAll });
      expect(() => loader.loadSkillFromFile(file)).toThrow(/denied/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads an explicit single file when the policy allows it", () => {
    const dir = mkdtempSync(join(tmpdir(), "oni-skill-policy-explicit-allow-"));
    try {
      const file = join(dir, "SKILL.md");
      writeFileSync(file, SKILL, "utf-8");
      const loader = new SkillLoader({ runtimePolicy: policyFor(dir) });
      expect(loader.loadSkillFromFile(file)).toBe(true);
      expect(loader.get("scoped-skill")).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves the policy across fork()", () => {
    const loader = new SkillLoader({ runtimePolicy: denyAll });
    const forked = loader.fork();
    expect(() => forked.loadSkillFromFile("/anywhere/SKILL.md")).toThrow(/denied/);
  });
});
