import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { inspectCommand } from "../cli/inspect.js";

describe("inspectCommand path validation (BUG-0243)", () => {
  let originalExitCode: number | undefined;

  beforeEach(() => {
    originalExitCode = process.exitCode as number | undefined;
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it("BUG-0243: rejects paths outside cwd (path traversal attempt)", async () => {
    // Before the fix, `args.positional[0]` flowed directly into `await import(file)`
    // with no path canonicalization, allowing arbitrary module loading.
    // e.g. passing "../../etc/passwd" would resolve outside cwd and execute.
    await inspectCommand({
      command: "inspect",
      positional: ["../../etc/shadow.ts"],
      flags: {},
    });

    expect(process.exitCode).toBe(1);
  });

  it("BUG-0243: rejects disallowed file extensions", async () => {
    // Only .ts, .js, .mts, .mjs, .cts, .cjs are allowed.
    // A .sh or .json file with executable content should not be loadable.
    await inspectCommand({
      command: "inspect",
      positional: ["./some-script.sh"],
      flags: {},
    });

    expect(process.exitCode).toBe(1);
  });

  it("BUG-0243: rejects .json extension (not in allowlist)", async () => {
    await inspectCommand({
      command: "inspect",
      positional: ["./package.json"],
      flags: {},
    });

    expect(process.exitCode).toBe(1);
  });

  it("BUG-0243: accepts a .ts file within cwd (passes path validation stage)", async () => {
    // A valid extension within cwd passes path validation and proceeds to import().
    // The import will fail (file likely does not export a graph), but exitCode=1
    // will be from the missing graph export, not the path validation guard.
    // We verify the error is NOT the path-validation or extension error.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await inspectCommand({
        command: "inspect",
        positional: ["./src/cli/inspect.ts"],
        flags: {},
      });
      // May succeed or fail for other reasons (no graph export), but
      // the path traversal and extension checks must not reject this.
      const errorCalls = consoleSpy.mock.calls.map((c) => String(c[0]));
      const pathGuardRejected = errorCalls.some(
        (msg) =>
          msg.includes("within the project directory") ||
          msg.includes("unsupported file extension"),
      );
      expect(pathGuardRejected).toBe(false);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
