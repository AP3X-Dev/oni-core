/**
 * Regression test for BUG-0081
 *
 * `SkillLoader.loadDirectory()` previously used `require("fs")` and
 * `require("path")`, which throw `ReferenceError: require is not defined` in
 * ESM environments (`"type": "module"`). The error was silently swallowed by
 * the catch block, causing all disk-based skill loading to return an empty
 * loader with no warning.
 *
 * Fix: replaced `require("fs")` / `require("path")` with static ESM imports
 * (`import fs from "node:fs"` / `import path from "node:path"`).
 *
 * This test verifies that `SkillLoader.fromDirectory()` and
 * `SkillLoader.fromDirectories()` actually load SKILL.md files from disk in
 * the ESM runtime, i.e. the `require()` calls are gone and the static imports
 * work correctly.
 */

import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SkillLoader } from "../harness/skill-loader.js";

const SKILL_CONTENT = `---
name: test-skill-bug0081
description: Regression skill for BUG-0081
---
Do the regression thing.
`;

describe("BUG-0081: SkillLoader.fromDirectory() loads SKILL.md via ESM imports", () => {
  it("fromDirectory() finds and loads a SKILL.md file from a real directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "oni-bug-0081-"));
    try {
      writeFileSync(join(dir, "SKILL.md"), SKILL_CONTENT, "utf-8");

      const loader = SkillLoader.fromDirectory(dir);

      // Before the fix, the loader silently returned empty due to require() crash
      expect(loader.getAll().length).toBe(1);
      const skill = loader.get("test-skill-bug0081");
      expect(skill).toBeDefined();
      expect(skill!.description).toBe("Regression skill for BUG-0081");
      expect(skill!.content.trim()).toBe("Do the regression thing.");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fromDirectory() recursively finds SKILL.md files in subdirectories", () => {
    const dir = mkdtempSync(join(tmpdir(), "oni-bug-0081-sub-"));
    try {
      const subDir = join(dir, "subdir");
      mkdirSync(subDir);
      writeFileSync(
        join(subDir, "SKILL.md"),
        `---
name: sub-skill-bug0081
description: Sub-directory skill
---
Sub content.
`,
        "utf-8",
      );

      const loader = SkillLoader.fromDirectory(dir);

      expect(loader.getAll().length).toBe(1);
      const skill = loader.get("sub-skill-bug0081");
      expect(skill).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fromDirectories() aggregates skills from multiple directories", () => {
    const dir1 = mkdtempSync(join(tmpdir(), "oni-bug-0081-d1-"));
    const dir2 = mkdtempSync(join(tmpdir(), "oni-bug-0081-d2-"));
    try {
      writeFileSync(
        join(dir1, "SKILL.md"),
        `---
name: skill-alpha
description: Alpha skill
---
Alpha content.
`,
        "utf-8",
      );
      writeFileSync(
        join(dir2, "SKILL.md"),
        `---
name: skill-beta
description: Beta skill
---
Beta content.
`,
        "utf-8",
      );

      const loader = SkillLoader.fromDirectories([dir1, dir2]);

      // Before the fix, both would have been silently skipped
      expect(loader.getAll().length).toBe(2);
      expect(loader.get("skill-alpha")).toBeDefined();
      expect(loader.get("skill-beta")).toBeDefined();
    } finally {
      rmSync(dir1, { recursive: true, force: true });
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("fromDirectory() returns an empty loader (not a crash) for a non-existent directory", () => {
    const loader = SkillLoader.fromDirectory("/non/existent/dir/__oni_test__");

    // Should gracefully return empty loader, not throw
    expect(loader.getAll().length).toBe(0);
  });
});
