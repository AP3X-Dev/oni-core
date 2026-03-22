import { describe, it, expect } from "vitest";
import { homedir, tmpdir } from "node:os";
import { normalize, resolve, join, sep } from "node:path";

// BUG-0245: LLM-exposed read_file tool in example harness files called
// readFile(input.path) with no path sanitization, allowing path traversal
// to arbitrary files on the host (e.g. /etc/passwd, ~/.ssh/id_rsa).
// Fix: Added boundary check using normalize(resolve()) against process.cwd().
// This test verifies the boundary-check logic that was introduced in the fix.

/**
 * Replicates the exact path boundary guard added to:
 *   examples/harness/codebase-audit.ts  (line 58-62)
 *   examples/audit-system/audit-agent.ts (line 100-104)
 */
function isPathAllowed(inputPath: string, cwd: string = process.cwd()): boolean {
  const boundary = normalize(resolve(cwd));
  const resolved = normalize(resolve(cwd, inputPath));
  return resolved.startsWith(boundary + sep) || resolved === boundary;
}

describe("BUG-0245: read_file tool path boundary check", () => {
  const cwd = join(tmpdir(), "audit-sandbox");

  it("BUG-0245: allows paths within the working directory", () => {
    expect(isPathAllowed(join(cwd, "src", "index.ts"), cwd)).toBe(true);
    expect(isPathAllowed(join(cwd, "package.json"), cwd)).toBe(true);
  });

  it("BUG-0245: allows the working directory itself", () => {
    expect(isPathAllowed(cwd, cwd)).toBe(true);
  });

  it("BUG-0245: blocks path traversal to parent directory (/etc/passwd style)", () => {
    expect(isPathAllowed(join(tmpdir(), "outside-audit-sandbox", "passwd"), cwd)).toBe(false);
    expect(isPathAllowed(join("..", "..", "etc", "passwd"), cwd)).toBe(false);
    expect(isPathAllowed(join(homedir(), ".ssh", "id_rsa"), cwd)).toBe(false);
  });

  it("BUG-0245: blocks path traversal that resolves outside cwd via double-dots", () => {
    // These all resolve outside the sandbox root.
    expect(isPathAllowed(join(cwd, "..", "..", "..", "etc", "shadow"), cwd)).toBe(false);
    expect(isPathAllowed(`${cwd}-evil`, cwd)).toBe(false);
  });

  it("BUG-0245: a sibling directory with a matching prefix is NOT allowed", () => {
    // Without the trailing separator guard, a sibling with a matching prefix
    // would pass a naive startsWith(boundary) check.
    expect(isPathAllowed(join(`${cwd}-evil`, "secret.txt"), cwd)).toBe(false);
  });

  it("BUG-0245: normalizes paths with redundant components before checking", () => {
    // These should be allowed — they normalize to paths inside cwd
    expect(isPathAllowed(join(cwd, ".", "subdir", "file.ts"), cwd)).toBe(true);
    expect(isPathAllowed(join(cwd, "subdir", "..", "file.ts"), cwd)).toBe(true);
  });
});
