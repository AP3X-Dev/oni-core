/**
 * Regression test for BUG-0245:
 * LLM-exposed read_file tool in example harness/audit-system must enforce a
 * path boundary check against process.cwd() to prevent path traversal attacks.
 *
 * Both affected files:
 *   - examples/harness/codebase-audit.ts (line 57-62)
 *   - examples/audit-system/audit-agent.ts (line 99-104)
 *
 * The fix uses an OS-aware separator when checking the normalized resolved path
 * stays within the normalized cwd boundary.
 */
import { describe, it, expect } from "vitest";
import { homedir, tmpdir } from "node:os";
import { join, normalize, resolve, sep } from "node:path";

/**
 * Replicate the boundary check logic used in both example files.
 * This tests that the guard correctly blocks path traversal.
 */
function checkBoundary(inputPath: string, cwd = process.cwd()): boolean {
  const boundary = normalize(resolve(cwd));
  const resolved = normalize(resolve(cwd, inputPath));
  return resolved.startsWith(boundary + sep) || resolved === boundary;
}

describe("BUG-0245: read_file path boundary check prevents traversal", () => {
  const cwd = join(tmpdir(), "oni-audit-boundary");

  it("allows a file within cwd", () => {
    expect(checkBoundary("package.json", cwd)).toBe(true);
  });

  it("allows a nested path within cwd", () => {
    expect(checkBoundary(join("src", "index.ts"), cwd)).toBe(true);
  });

  it("blocks a simple path traversal attempt", () => {
    expect(checkBoundary(join("..", "..", "etc", "passwd"), cwd)).toBe(false);
  });

  it("blocks an absolute path outside cwd", () => {
    expect(checkBoundary(join(tmpdir(), "oni-outside-boundary", "passwd"), cwd)).toBe(false);
  });

  it("blocks a path that reaches the filesystem root", () => {
    expect(checkBoundary(join("..", "..", "..", "..", "..", "..", "..", "etc", "shadow"), cwd)).toBe(false);
  });

  it("blocks a path that normalizes to a parent directory", () => {
    expect(checkBoundary(join("src", "..", "..", "outside"), cwd)).toBe(false);
  });

  it("blocks ssh key access attempt", () => {
    // Common LLM prompt-injection target
    const home = homedir();
    // If home is inside cwd, skip; otherwise verify blocked
    const resolved = normalize(resolve(home, ".ssh", "id_rsa"));
    const boundary = normalize(resolve(cwd));
    const blocked = !resolved.startsWith(boundary + sep) && resolved !== boundary;
    // In any normal setup, ~/.ssh is not inside the project cwd
    if (blocked) {
      expect(checkBoundary(join(home, ".ssh", "id_rsa"), cwd)).toBe(false);
    }
    // If home IS inside cwd (unusual CI setup), just verify the logic doesn't throw
    expect(true).toBe(true);
  });

  it("allows cwd itself (boundary exact match)", () => {
    expect(checkBoundary(".", cwd)).toBe(true);
  });

  it("the guard exists in examples/harness/codebase-audit.ts", async () => {
    // Verify the boundary check is present in the actual example file source
    const { readFile } = await import("node:fs/promises");
    const filePath = resolve(process.cwd(), "examples/harness/codebase-audit.ts");
    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("boundary");
    expect(content).toContain("resolve(process.cwd())");
    expect(content).toContain("Access denied");
    expect(content).toContain("boundary + sep");
  });

  it("the guard exists in examples/audit-system/audit-agent.ts", async () => {
    const { readFile } = await import("node:fs/promises");
    const filePath = resolve(process.cwd(), "examples/audit-system/audit-agent.ts");
    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("boundary");
    expect(content).toContain("resolve(process.cwd())");
    expect(content).toContain("Access denied");
    expect(content).toContain("boundary + sep");
  });
});
