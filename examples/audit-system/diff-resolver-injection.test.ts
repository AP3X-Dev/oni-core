import { describe, it, expect, vi } from "vitest";

// Mock child_process before importing the module under test
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => "src/changed.ts\n"),
}));

import { resolveFiles } from "./diff-resolver.js";
import { execFileSync } from "node:child_process";

describe("diff-resolver command injection guard", () => {
  it("BUG-0063: resolveFiles passes baseBranch safely via execFileSync array args", async () => {
    // Before the fix, baseBranch was interpolated into an execSync shell string:
    //   execSync(`git diff --name-only ${opts.baseBranch}...HEAD`)
    // A baseBranch like "main; rm -rf /" would execute the injected command.
    // The fix uses execFileSync with an argument array, preventing shell interpretation.
    const maliciousBranch = "main; rm -rf /";

    await resolveFiles({ mode: "diff", targetDir: "/tmp", baseBranch: maliciousBranch });

    // execFileSync must receive the branch as an array argument (safe),
    // not interpolated into a shell command string (vulnerable)
    expect(execFileSync).toHaveBeenCalledWith(
      "git",
      ["diff", "--name-only", `${maliciousBranch}...HEAD`],
      expect.objectContaining({ encoding: "utf-8" }),
    );
  });
});
