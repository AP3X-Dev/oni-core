import { describe, it, expect } from "vitest";
import { fileSystemTools } from "../filesystem/index.js";

describe("fileSystemTools — BUG-0025 secure default allowedPaths", () => {
  it("BUG-0025: should default allowedPaths to [process.cwd()] when not specified", async () => {
    // Calling fileSystemTools() with no arguments must restrict access to cwd.
    // Before the fix, checkAllowedPath returned immediately with no restriction,
    // allowing any path to be read/written. After the fix, paths outside cwd
    // must be rejected with an Access denied error.
    const tools = fileSystemTools();
    const readTool = tools.find((t) => t.name === "fs_read_file")!;

    // A path clearly outside cwd must be denied.
    await expect(
      readTool.execute({ path: "/etc/passwd" }, {} as never)
    ).rejects.toThrow("Access denied");

    // A path inside cwd must pass the allowedPaths check (may fail with ENOENT,
    // but must NOT throw Access denied).
    try {
      await readTool.execute({ path: process.cwd() }, {} as never);
    } catch (err: unknown) {
      const msg = (err as Error).message;
      expect(msg).not.toContain("Access denied");
    }
  });
});
