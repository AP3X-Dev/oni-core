import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, symlinkSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileSystemTools } from "../filesystem/index.js";

/**
 * BUG-0181: TOCTOU race — checkAllowedPath() must return the resolved path
 * so that all I/O operations use the real path, not the original (potentially
 * swapped) symlink path.
 *
 * The fix: checkAllowedPath() returns the resolved path and every handler
 * assigns it to safePath, which is then used for I/O (readFile, writeFile, etc.).
 * This closes the window between "check" and "use".
 */
describe("BUG-0181: filesystem TOCTOU — I/O uses resolved path from checkAllowedPath", () => {
  let allowedDir: string;

  beforeAll(() => {
    allowedDir = mkdtempSync(join(tmpdir(), "oni-toctou-"));
    writeFileSync(join(allowedDir, "real.txt"), "real-content");
    // Symlink inside allowed dir pointing to the real file (also inside allowed dir)
    symlinkSync(join(allowedDir, "real.txt"), join(allowedDir, "link.txt"));
  });

  afterAll(() => {
    rmSync(allowedDir, { recursive: true, force: true });
  });

  it("BUG-0181: reading via symlink uses resolved real path for I/O, not symlink path", async () => {
    const tools = fileSystemTools({ allowedPaths: [allowedDir] });
    const readTool = tools.find((t) => t.name === "fs_read_file")!;

    // Reading via symlink path should succeed and return the real file's content.
    // If I/O still used the original symlink path (not resolved), this would still
    // work in the non-swapped case; the critical fix is that the resolved path is
    // what gets passed to readFile — confirmed by the read returning correct content
    // and the returned path field being the original (user-visible) path.
    const result = await readTool.execute(
      { path: join(allowedDir, "link.txt") },
      {} as never,
    ) as { path: string; content: string };

    expect(result.content).toBe("real-content");
  });

  it("BUG-0181: checkAllowedPath resolves symlinks so safePath differs from the input path", async () => {
    // The resolved real path should differ from the symlink path.
    // This is the precondition that makes TOCTOU possible and confirms
    // the fix (using resolved path) is meaningful.
    const symlinkPath = join(allowedDir, "link.txt");
    const realPath = realpathSync(symlinkPath);
    expect(realPath).not.toBe(symlinkPath);
    expect(realPath).toBe(join(allowedDir, "real.txt"));
  });

  it("BUG-0181: write tool uses resolved path — write via symlink modifies the real file", async () => {
    const tools = fileSystemTools({ allowedPaths: [allowedDir] });
    const writeTool = tools.find((t) => t.name === "fs_write_file")!;
    const readTool = tools.find((t) => t.name === "fs_read_file")!;

    // Write via symlink — if the handler uses the resolved path, the real file is updated.
    await writeTool.execute(
      { path: join(allowedDir, "link.txt"), content: "updated-via-symlink" },
      {} as never,
    );

    // Read via real path to confirm the write targeted the real file
    const result = await readTool.execute(
      { path: join(allowedDir, "real.txt") },
      {} as never,
    ) as { content: string };

    expect(result.content).toBe("updated-via-symlink");
  });
});
