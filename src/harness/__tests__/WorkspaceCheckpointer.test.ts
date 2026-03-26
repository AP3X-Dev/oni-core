import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkspaceCheckpointer } from "../WorkspaceCheckpointer.js";
import type { WorkspaceCheckpointerConfig } from "../WorkspaceCheckpointer.js";
import * as utils from "../utils.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ----------------------------------------------------------------
// We mock the SqliteCheckpointer since it requires better-sqlite3.
// These tests focus on the git-awareness layer.
// ----------------------------------------------------------------

vi.mock("../../checkpointers/sqlite.js", () => {
  return {
    SqliteCheckpointer: {
      create: vi.fn().mockImplementation(async () => {
        const checkpoints = new Map<string, Map<number, unknown>>();
        return {
          get: vi.fn(async (threadId: string) => {
            const steps = checkpoints.get(threadId);
            if (!steps || steps.size === 0) return null;
            const maxStep = Math.max(...steps.keys());
            return steps.get(maxStep) ?? null;
          }),
          put: vi.fn(async (cp: Record<string, unknown>) => {
            const threadId = cp.threadId as string;
            const step = cp.step as number;
            if (!checkpoints.has(threadId)) checkpoints.set(threadId, new Map());
            checkpoints.get(threadId)!.set(step, cp);
          }),
          getAt: vi.fn(async (threadId: string, step: number) => {
            return checkpoints.get(threadId)?.get(step) ?? null;
          }),
          list: vi.fn(async (threadId: string) => {
            const steps = checkpoints.get(threadId);
            return steps ? [...steps.values()] : [];
          }),
          delete: vi.fn(async (threadId: string) => { checkpoints.delete(threadId); }),
          close: vi.fn(),
        };
      }),
    },
  };
});

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

describe("WorkspaceCheckpointer", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "oni-wc-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeConfig(overrides?: Partial<WorkspaceCheckpointerConfig>): WorkspaceCheckpointerConfig {
    return {
      dbPath: join(tmpDir, "checkpointer.db"),
      workspaceDir: process.cwd(),
      autoCommit: false,
      commitMessagePrefix: "chore(oni):",
      ...overrides,
    };
  }

  it("create() returns a WorkspaceCheckpointer instance", async () => {
    const wc = await WorkspaceCheckpointer.create(makeConfig());
    expect(wc).toBeDefined();
    wc.close();
  });

  it("delegates get/put/list/delete to underlying SqliteCheckpointer", async () => {
    const wc = await WorkspaceCheckpointer.create(makeConfig());

    const checkpoint = {
      threadId: "test-thread",
      step: 0,
      state: { value: 42 },
      nextNodes: [],
      pendingSends: [],
      timestamp: Date.now(),
    };

    await wc.put(checkpoint);
    const result = await wc.get("test-thread");
    expect(result).toBeDefined();

    const list = await wc.list("test-thread");
    expect(list).toBeDefined();

    wc.close();
  });

  it("put() writes checkpoint to SQLite without git when autoCommit=false", async () => {
    const wc = await WorkspaceCheckpointer.create(makeConfig());

    const checkpoint = {
      threadId: "put-test",
      step: 1,
      state: { v: 1 },
      nextNodes: [],
      pendingSends: [],
      timestamp: Date.now(),
    };

    await wc.put(checkpoint);
    const result = await wc.get("put-test");
    expect(result).toBeDefined();
    wc.close();
  });

  it("listWithCommits() returns empty when no commits exist", async () => {
    const wc = await WorkspaceCheckpointer.create(makeConfig());
    const commits = await wc.listWithCommits();
    expect(commits).toEqual([]);
    wc.close();
  });

  it("put() with autoCommit stages and commits when git is available", async () => {
    const execGitSpy = vi.spyOn(utils, "execGit");
    const isGitSpy = vi.spyOn(utils, "isGitAvailable").mockReturnValue(true);

    // Mock git commands — execGit now takes string[] not string
    execGitSpy.mockImplementation((args: string[]) => {
      if (args[0] === "--version") return "git version 2.40.0";
      if (args[0] === "add") return "";
      if (args[0] === "status") return "M file.ts";
      if (args[0] === "commit") return "";
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "abc123def456";
      return "";
    });

    const wc = await WorkspaceCheckpointer.create(makeConfig({ autoCommit: true }));
    wc.setNextMetadata({ description: "feature X" });

    const checkpoint = {
      threadId: "commit-test",
      step: 2,
      state: { v: 2 },
      nextNodes: [],
      pendingSends: [],
      timestamp: Date.now(),
    };

    // put() — the method Pregel calls — should trigger git
    await wc.put(checkpoint);

    // Verify git commands were called with arg arrays
    expect(execGitSpy).toHaveBeenCalledWith(["add", "-A"], expect.any(String));
    expect(execGitSpy).toHaveBeenCalledWith(["status", "--porcelain"], expect.any(String));

    // Verify commit mapping was stored
    const commits = await wc.listWithCommits();
    expect(commits).toHaveLength(1);
    expect(commits[0]!.commitHash).toBe("abc123def456");

    wc.close();
    execGitSpy.mockRestore();
    isGitSpy.mockRestore();
  });

  it("degrades gracefully when git is unavailable", async () => {
    const isGitSpy = vi.spyOn(utils, "isGitAvailable").mockReturnValue(false);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const wc = await WorkspaceCheckpointer.create(makeConfig({ autoCommit: true }));

    const checkpoint = {
      threadId: "no-git",
      step: 0,
      state: { v: 0 },
      nextNodes: [],
      pendingSends: [],
      timestamp: Date.now(),
    };

    // put() should still work — just without git
    await wc.put(checkpoint);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("git not found"),
    );

    wc.close();
    isGitSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("diff() throws when commit mappings not found", async () => {
    const wc = await WorkspaceCheckpointer.create(makeConfig());

    await expect(wc.diff("cp1", "cp2")).rejects.toThrow(
      "Commit mapping not found",
    );

    wc.close();
  });

  it("rollbackTo() throws when commit mapping not found", async () => {
    const wc = await WorkspaceCheckpointer.create(makeConfig());

    await expect(wc.rollbackTo("some-checkpoint")).rejects.toThrow(
      "No commit mapping found",
    );

    wc.close();
  });

  it("setNextMetadata() influences commit message in put()", async () => {
    const execGitSpy = vi.spyOn(utils, "execGit");
    const isGitSpy = vi.spyOn(utils, "isGitAvailable").mockReturnValue(true);

    let capturedMessage = "";
    execGitSpy.mockImplementation((args: string[]) => {
      if (args[0] === "commit" && args[1] === "-m") {
        capturedMessage = args[2]!;
      }
      if (args[0] === "status") return "M file.ts";
      if (args[0] === "rev-parse") return "deadbeef";
      return "";
    });

    const wc = await WorkspaceCheckpointer.create(makeConfig({ autoCommit: true }));
    wc.setNextMetadata({ description: "login page" });

    await wc.put({
      threadId: "meta-test",
      step: 1,
      state: {},
      nextNodes: [],
      pendingSends: [],
      timestamp: Date.now(),
    });

    expect(capturedMessage).toContain("login page");

    wc.close();
    execGitSpy.mockRestore();
    isGitSpy.mockRestore();
  });
});
