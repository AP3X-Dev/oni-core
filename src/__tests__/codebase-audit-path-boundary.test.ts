import { describe, it, expect } from "vitest";
import { normalize, resolve, join } from "node:path";

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
  const resolved = normalize(resolve(inputPath));
  return resolved.startsWith(boundary + "/") || resolved === boundary;
}

describe("BUG-0245: read_file tool path boundary check", () => {
  it("BUG-0245: allows paths within the working directory", () => {
    const cwd = process.cwd();
    expect(isPathAllowed(join(cwd, "src", "index.ts"), cwd)).toBe(true);
    expect(isPathAllowed(join(cwd, "package.json"), cwd)).toBe(true);
  });

  it("BUG-0245: allows the working directory itself", () => {
    const cwd = process.cwd();
    expect(isPathAllowed(cwd, cwd)).toBe(true);
  });

  it("BUG-0245: blocks path traversal to parent directory (/etc/passwd style)", () => {
    const cwd = "/tmp/audit-sandbox";
    expect(isPathAllowed("/etc/passwd", cwd)).toBe(false);
    expect(isPathAllowed("../../etc/passwd", cwd)).toBe(false);
    expect(isPathAllowed("/root/.ssh/id_rsa", cwd)).toBe(false);
  });

  it("BUG-0245: blocks path traversal that resolves outside cwd via double-dots", () => {
    const cwd = "/tmp/audit-sandbox";
    // These all resolve outside /tmp/audit-sandbox
    expect(isPathAllowed("/tmp/audit-sandbox/../../../etc/shadow", cwd)).toBe(false);
    expect(isPathAllowed("/tmp/audit-sandbox-evil", cwd)).toBe(false);
  });

  it("BUG-0245: a sibling directory with a matching prefix is NOT allowed", () => {
    // Without the trailing "/" guard, /tmp/audit-sandbox-evil would pass
    // a naive startsWith("/tmp/audit-sandbox") check.
    const cwd = "/tmp/audit-sandbox";
    expect(isPathAllowed("/tmp/audit-sandbox-evil/secret.txt", cwd)).toBe(false);
  });

  it("BUG-0245: normalizes paths with redundant components before checking", () => {
    const cwd = "/tmp/audit-sandbox";
    // These should be allowed — they normalize to paths inside cwd
    expect(isPathAllowed("/tmp/audit-sandbox/./subdir/file.ts", cwd)).toBe(true);
    expect(isPathAllowed("/tmp/audit-sandbox/subdir/../file.ts", cwd)).toBe(true);
  });
});
