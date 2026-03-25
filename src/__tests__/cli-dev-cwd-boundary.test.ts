/**
 * BUG-0417 regression test
 *
 * devCommand must reject entry file paths that resolve outside the project
 * directory (cwd boundary check). A path like "../../etc/profile" must be
 * refused before tsx is spawned.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { devCommand } from "../cli/dev.js";

describe("devCommand — cwd boundary check (BUG-0417)", () => {
  let errorMessages: string[];

  beforeEach(() => {
    errorMessages = [];

    vi.spyOn(process, "cwd").mockReturnValue("/home/user/project");
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errorMessages.push(args.join(" "));
    });
    // Suppress normal console.log output during tests
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects a path that traverses above cwd via ../../", async () => {
    await devCommand({ positional: ["../../etc/profile"], flags: {} });

    expect(errorMessages.some((m) => m.includes("project directory"))).toBe(true);
  });

  it("rejects an absolute path outside the project directory", async () => {
    await devCommand({ positional: ["/tmp/evil.ts"], flags: {} });

    expect(errorMessages.some((m) => m.includes("project directory"))).toBe(true);
  });

  it("rejects a path that normalises to the parent directory", async () => {
    await devCommand({ positional: ["../sibling/index.ts"], flags: {} });

    expect(errorMessages.some((m) => m.includes("project directory"))).toBe(true);
  });
});
