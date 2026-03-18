import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileSystemTools } from "../filesystem/index.js";

describe("BUG-0065: symlink escape blocked by checkAllowedPath realpath resolution", () => {
  let allowedDir: string;
  let outsideDir: string;
  const secretContent = "sensitive-data-outside-allowed-path";

  beforeAll(() => {
    // Create two temp directories: one "allowed" and one "outside"
    allowedDir = mkdtempSync(join(tmpdir(), "oni-allowed-"));
    outsideDir = mkdtempSync(join(tmpdir(), "oni-outside-"));

    // Place a secret file outside the allowed directory
    writeFileSync(join(outsideDir, "secret.txt"), secretContent);

    // Create a symlink inside the allowed directory pointing to the outside file
    symlinkSync(join(outsideDir, "secret.txt"), join(allowedDir, "escape-link"));
  });

  afterAll(() => {
    rmSync(allowedDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  });

  it("BUG-0065: should reject symlink that resolves outside allowed paths", async () => {
    const tools = fileSystemTools({ allowedPaths: [allowedDir] });
    const readTool = tools.find((t) => t.name === "fs_read_file")!;

    // The symlink path is lexically inside allowedDir, but resolves outside it.
    // Before the fix, checkAllowedPath only did a lexical prefix check and
    // would approve this path. After the fix, it follows the symlink via
    // realpathSync and rejects the real target.
    await expect(
      readTool.execute({ path: join(allowedDir, "escape-link") }, {} as never)
    ).rejects.toThrow(/Access denied.*symlink/);
  });
});
