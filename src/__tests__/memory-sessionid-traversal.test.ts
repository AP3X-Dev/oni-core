import { describe, it, expect } from "vitest";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { MemoryLoader } from "../harness/memory/index.js";

describe("MemoryLoader.persistEpisodic path traversal guard", () => {
  it("BUG-0075: sessionId with path traversal sequences must not escape episodic/recent/", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oni-test-mem-"));
    try {
      const loader = MemoryLoader.fromRoot(tmpDir);

      // Attempt path traversal via sessionId
      const maliciousSessionId = "../../identity/MANIFEST";
      loader.persistEpisodic(maliciousSessionId, "# Injected content");

      // The file must NOT exist at the traversal target
      const traversalTarget = path.join(tmpDir, "identity", "MANIFEST.md");
      expect(fs.existsSync(traversalTarget)).toBe(false);

      // The file must exist safely inside episodic/recent/ with sanitized name
      const recentDir = path.join(tmpDir, "episodic", "recent");
      const files = fs.readdirSync(recentDir);
      // The sanitized filename should contain underscores instead of ../
      const written = files.find((f) => f.includes("____identity_MANIFEST"));
      expect(written).toBeDefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
