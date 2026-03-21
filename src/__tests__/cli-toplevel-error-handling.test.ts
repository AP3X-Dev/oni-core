// Regression test for BUG-0373
// Top-level runCLI() rejection must propagate so the .catch() handler in
// src/cli/index.ts can print a clean error and exit(1) instead of crashing
// with a raw, unformatted uncaught exception.

import { describe, it, expect, vi } from "vitest";
import { runCLI } from "../cli/router.js";

describe("BUG-0373 — runCLI rejection propagates cleanly", () => {
  it("rejects with the original error when a command handler throws synchronously", async () => {
    const boom = new Error("command handler crashed");
    const commands = {
      explode: async () => {
        throw boom;
      },
    };

    await expect(runCLI(["explode"], commands)).rejects.toThrow("command handler crashed");
  });

  it("rejects with the original error when a command handler returns a rejected promise", async () => {
    const commands = {
      failAsync: async () => {
        return Promise.reject(new Error("async rejection"));
      },
    };

    await expect(runCLI(["failAsync"], commands)).rejects.toThrow("async rejection");
  });

  it("does not swallow the error — rejects rather than resolving on handler failure", async () => {
    let settled = false;
    const commands = {
      crash: async () => {
        throw new Error("crash!");
      },
    };

    const p = runCLI(["crash"], commands);
    // The promise must reject, not resolve
    await p.then(
      () => {
        settled = true;
        throw new Error("Expected rejection but got resolution");
      },
      () => {
        settled = true;
      },
    );
    expect(settled).toBe(true);
  });

  it("resolves cleanly when a command handler succeeds", async () => {
    const commands = {
      ok: async () => {
        // no-op
      },
    };

    await expect(runCLI(["ok"], commands)).resolves.toBeUndefined();
  });

  it("resolves without error for unknown commands (exits via process.exitCode, not throw)", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(runCLI(["unknown-cmd"], {})).resolves.toBeUndefined();

    consoleSpy.mockRestore();
    logSpy.mockRestore();
  });
});
