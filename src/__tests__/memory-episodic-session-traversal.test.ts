import { describe, it, expect, afterEach } from "vitest";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { MemoryLoader } from "../harness/memory/index.js";

/**
 * Regression test for BUG-0075: sessionId path traversal in persistEpisodic().
 *
 * Before the fix, a sessionId like "../../identity/MANIFEST" was interpolated
 * directly into the filename used for path.join(), allowing an attacker who
 * controls the session ID to write files outside the episodic/recent/ directory.
 *
 * After the fix, the sessionId is sanitised — ".." sequences and path separators
 * are replaced with underscores — so the resolved path always stays within the
 * memory root.
 */

describe("MemoryLoader.persistEpisodic — sessionId path traversal (BUG-0075)", () => {
  const tmpDirs: string[] = [];

  function makeTmpRoot(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oni-mem-bug0075-"));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("BUG-0075: path-traversal sessionId does not escape the memory root", () => {
    const root = makeTmpRoot();
    const loader = MemoryLoader.fromRoot(root);

    // This sessionId attempts to write outside episodic/recent/ via ../ segments.
    const maliciousSessionId = "../../identity/MANIFEST";

    // The call must not throw AND must not create any file outside root.
    expect(() => {
      loader.persistEpisodic(maliciousSessionId, "adversarial content");
    }).not.toThrow();

    // The targeted escape path must NOT exist.
    const escapedPath = path.join(root, "identity", "MANIFEST.md");
    expect(fs.existsSync(escapedPath)).toBe(false);

    // A file SHOULD exist under the safe episodic/recent/ directory.
    const recentDir = path.join(root, "episodic", "recent");
    const recentFiles = fs.readdirSync(recentDir);
    // At least one file was written inside the allowed directory.
    expect(recentFiles.length).toBeGreaterThan(0);
    // The filename should NOT contain ".." or path separators.
    for (const f of recentFiles) {
      expect(f).not.toContain("..");
      expect(f).not.toContain("/");
      expect(f).not.toContain("\\");
    }
  });

  it("BUG-0075: sessionId with backslash separator is sanitised", () => {
    const root = makeTmpRoot();
    const loader = MemoryLoader.fromRoot(root);

    expect(() => {
      loader.persistEpisodic("session\\evilfile", "content");
    }).not.toThrow();

    const recentDir = path.join(root, "episodic", "recent");
    const recentFiles = fs.readdirSync(recentDir);
    expect(recentFiles.length).toBeGreaterThan(0);
    for (const f of recentFiles) {
      expect(f).not.toContain("\\");
    }
  });

  it("BUG-0075: benign sessionId writes to episodic/recent without modification", () => {
    const root = makeTmpRoot();
    const loader = MemoryLoader.fromRoot(root);

    const sessionId = "session-abc-123";
    loader.persistEpisodic(sessionId, "# Session log\n\nHello.");

    const recentDir = path.join(root, "episodic", "recent");
    const recentFiles = fs.readdirSync(recentDir);
    const match = recentFiles.find((f) => f.includes(sessionId));
    expect(match).toBeDefined();
  });
});
