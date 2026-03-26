import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionBridge } from "../SessionBridge.js";
import { SessionBridgeNotOpenError } from "../errors.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "oni-sb-test-"));
}

function makeProgress(overrides?: Partial<ReturnType<typeof makeProgress>>) {
  return {
    featuresAttempted: ["f1"],
    featuresPassed: ["f1"],
    featuresFailed: [],
    summary: "Implemented feature f1 successfully.",
    ...overrides,
  };
}

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

describe("SessionBridge", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── open() ──

  it("open() returns 'init' mode when no prior artifacts exist", async () => {
    const bridge = new SessionBridge(tmpDir);
    const result = await bridge.open();

    expect(result.mode).toBe("init");
    expect(result.artifact).toBeNull();
  });

  it("open() returns 'resume' mode when a prior artifact exists", async () => {
    // First session
    const bridge1 = new SessionBridge(tmpDir);
    await bridge1.open();
    await bridge1.close(makeProgress(), "Notes for next session");

    // Second session
    const bridge2 = new SessionBridge(tmpDir);
    const result = await bridge2.open();

    expect(result.mode).toBe("resume");
    expect(result.artifact).not.toBeNull();
    expect(result.artifact!.progress.summary).toBe("Implemented feature f1 successfully.");
  });

  // ── close() ──

  it("close() writes a complete artifact", async () => {
    const bridge = new SessionBridge(tmpDir);
    await bridge.open();

    const artifact = await bridge.close(
      makeProgress(),
      "Handoff notes here",
      { gitCommitHash: "abc123", gitBranch: "main" },
      { suggestedFirstAction: "Run tests", blockers: ["flaky CI"] },
    );

    expect(artifact.sessionId).toBeTruthy();
    expect(artifact.startedAt).toBeTruthy();
    expect(artifact.endedAt).toBeTruthy();
    expect(artifact.progress.summary).toBe("Implemented feature f1 successfully.");
    expect(artifact.handoffNotes).toBe("Handoff notes here");
    expect(artifact.environment.gitCommitHash).toBe("abc123");
    expect(artifact.nextSession.blockers).toEqual(["flaky CI"]);
  });

  it("close() throws if session was never opened", async () => {
    const bridge = new SessionBridge(tmpDir);
    await expect(
      bridge.close(makeProgress(), "notes"),
    ).rejects.toThrow(SessionBridgeNotOpenError);
  });

  it("close() links to previous session via previousSessionId", async () => {
    const bridge1 = new SessionBridge(tmpDir);
    await bridge1.open();
    const first = await bridge1.close(makeProgress(), "first");

    const bridge2 = new SessionBridge(tmpDir);
    await bridge2.open();
    const second = await bridge2.close(makeProgress(), "second");

    expect(second.previousSessionId).toBe(first.sessionId);
  });

  // ── history() ──

  it("history() returns artifacts in newest-first order by timestamp", async () => {
    // Create 3 sessions
    for (let i = 0; i < 3; i++) {
      const bridge = new SessionBridge(tmpDir);
      await bridge.open();
      await bridge.close(
        makeProgress({ summary: `Session ${i}` }),
        `Notes ${i}`,
      );
    }

    const bridge = new SessionBridge(tmpDir);
    const hist = await bridge.history();
    expect(hist).toHaveLength(3);

    // Verify newest-first ordering by comparing timestamps
    for (let i = 0; i < hist.length - 1; i++) {
      const timeA = hist[i]!.endedAt ?? hist[i]!.startedAt;
      const timeB = hist[i + 1]!.endedAt ?? hist[i + 1]!.startedAt;
      expect(timeA >= timeB).toBe(true);
    }
  });

  it("history(n) limits to N results", async () => {
    for (let i = 0; i < 5; i++) {
      const bridge = new SessionBridge(tmpDir);
      await bridge.open();
      await bridge.close(makeProgress(), `Notes ${i}`);
    }

    const bridge = new SessionBridge(tmpDir);
    const hist = await bridge.history(2);
    expect(hist).toHaveLength(2);
  });

  it("history() returns empty array when no artifacts exist", async () => {
    const bridge = new SessionBridge(tmpDir);
    const hist = await bridge.history();
    expect(hist).toEqual([]);
  });

  // ── contextSummary() ──

  it("contextSummary() returns init message when no prior sessions", async () => {
    const bridge = new SessionBridge(tmpDir);
    const summary = await bridge.contextSummary();
    expect(summary).toContain("init");
    expect(summary).toContain("No prior sessions");
  });

  it("contextSummary() includes prior session details", async () => {
    const bridge1 = new SessionBridge(tmpDir);
    await bridge1.open();
    await bridge1.close(
      makeProgress({ summary: "Built the login page" }),
      "Check auth flow",
      {},
      { blockers: ["Database migration pending"], suggestedFirstAction: "Run migrations" },
    );

    const bridge2 = new SessionBridge(tmpDir);
    const summary = await bridge2.contextSummary();
    expect(summary).toContain("resume");
    expect(summary).toContain("Built the login page");
    expect(summary).toContain("Database migration pending");
    expect(summary).toContain("Run migrations");
  });

  // ── Mode detection ──

  it("artifact mode reflects init vs resume correctly", async () => {
    const bridge1 = new SessionBridge(tmpDir);
    await bridge1.open();
    const first = await bridge1.close(makeProgress(), "first");
    expect(first.mode).toBe("init");
    expect(first.previousSessionId).toBeNull();

    const bridge2 = new SessionBridge(tmpDir);
    await bridge2.open();
    const second = await bridge2.close(makeProgress(), "second");
    expect(second.mode).toBe("resume");
    expect(second.previousSessionId).toBe(first.sessionId);
  });
});
