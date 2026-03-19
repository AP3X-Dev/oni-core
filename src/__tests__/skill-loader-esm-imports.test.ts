import { describe, it, expect } from "vitest";
import { SkillLoader } from "../harness/skill-loader.js";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

describe("BUG-0081: SkillLoader.loadDirectory uses ESM imports, not require()", () => {
  it("BUG-0081: fromDirectory should load SKILL.md files without ReferenceError from require()", () => {
    // Create a temp directory with a valid SKILL.md
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-loader-test-"));
    const skillContent = `---
name: test-skill
description: A test skill
---

Test skill content.
`;
    fs.writeFileSync(path.join(tmpDir, "SKILL.md"), skillContent);

    try {
      // Before the fix, this would throw ReferenceError: require is not defined
      // because loadDirectory() called require("fs") and require("path")
      const loader = SkillLoader.fromDirectory(tmpDir);

      // Verify the skill was actually loaded (not silently swallowed)
      const skill = loader.get("test-skill");
      expect(skill).toBeDefined();
      expect(skill!.name).toBe("test-skill");
      expect(skill!.description).toBe("A test skill");
      expect(skill!.content).toBe("Test skill content.");
    } finally {
      // Cleanup
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
