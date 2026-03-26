import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ContextReset } from "../ContextReset.js";
import { SessionBridge } from "../SessionBridge.js";
import { FeatureRegistry } from "../FeatureRegistry.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "oni-cr-test-"));
}

const SAMPLE_FEATURES = [
  {
    category: "functional" as const,
    description: "Feature A",
    priority: 1,
    steps: ["Step 1", "Step 2"],
  },
  {
    category: "visual" as const,
    description: "Feature B",
    priority: 2,
    steps: ["Step 3"],
  },
];

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

describe("ContextReset", () => {
  let tmpDir: string;
  let bridgeDir: string;
  let registryPath: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    bridgeDir = join(tmpDir, "sessions");
    registryPath = join(tmpDir, "features.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── shouldReset() ──

  it("shouldReset() returns true when above threshold", () => {
    const reset = new ContextReset({
      bridge: new SessionBridge(bridgeDir),
      registry: new FeatureRegistry(registryPath),
      autoResetThreshold: 0.80,
    });

    expect(reset.shouldReset(85_000, 100_000)).toBe(true);
    expect(reset.shouldReset(80_000, 100_000)).toBe(true);
    expect(reset.shouldReset(79_999, 100_000)).toBe(false);
  });

  it("shouldReset() returns false for zero maxTokens", () => {
    const reset = new ContextReset({
      bridge: new SessionBridge(bridgeDir),
      registry: new FeatureRegistry(registryPath),
    });

    expect(reset.shouldReset(1000, 0)).toBe(false);
  });

  it("shouldReset() uses default 0.80 threshold", () => {
    const reset = new ContextReset({
      bridge: new SessionBridge(bridgeDir),
      registry: new FeatureRegistry(registryPath),
    });

    expect(reset.shouldReset(800, 1000)).toBe(true);
    expect(reset.shouldReset(799, 1000)).toBe(false);
  });

  // ── execute() ──

  it("execute() closes session and returns handoff data", async () => {
    const bridge = new SessionBridge(bridgeDir);
    const registry = new FeatureRegistry(registryPath);
    await registry.initialize(SAMPLE_FEATURES);

    // Must open before we can close
    await bridge.open();

    const reset = new ContextReset({ bridge, registry });

    const result = await reset.execute(
      {
        featuresAttempted: ["f1"],
        featuresPassed: ["f1"],
        featuresFailed: [],
        summary: "Completed feature A",
      },
      "Continue with feature B",
    );

    expect(result.newSessionId).toBeTruthy();
    expect(result.artifact).toBeDefined();
    expect(result.artifact.progress.summary).toBe("Completed feature A");
    expect(result.contextSummary).toContain("resuming work");
  });

  it("execute() includes next feature in context summary", async () => {
    const bridge = new SessionBridge(bridgeDir);
    const registry = new FeatureRegistry(registryPath);
    await registry.initialize(SAMPLE_FEATURES);
    await bridge.open();

    const reset = new ContextReset({ bridge, registry });

    const result = await reset.execute(
      { featuresAttempted: [], featuresPassed: [], featuresFailed: [], summary: "Starting" },
      "Begin work",
    );

    // Context summary should reference Feature A (priority 1)
    expect(result.contextSummary).toContain("Feature A");
  });

  // ── buildResumePrompt() ──

  it("buildResumePrompt() produces structured prompt with default orientation steps", () => {
    const artifact = {
      sessionId: "test-session",
      previousSessionId: null,
      mode: "init" as const,
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T01:00:00.000Z",
      agentVersion: "1.1.1",
      progress: {
        featuresAttempted: ["f1"],
        featuresPassed: ["f1"],
        featuresFailed: [],
        summary: "Implemented user login",
      },
      environment: {
        workingDirectory: "/app",
        gitCommitHash: "abc123",
        gitBranch: "main",
        serverRunning: false,
        lastSmokeTestPassed: true,
        lastSmokeTestAt: "2026-01-01T00:30:00.000Z",
      },
      nextSession: {
        suggestedFirstAction: "Run tests",
        blockers: ["Flaky CI"],
        nextFeatureId: "f2",
      },
      handoffNotes: "Check the login redirect",
    };

    const feature = {
      id: "f2",
      category: "visual" as const,
      description: "Dashboard layout",
      priority: 2,
      steps: ["Check responsive grid", "Verify sidebar"],
      passes: false,
    };

    const prompt = ContextReset.buildResumePrompt(artifact, feature);

    expect(prompt).toContain("resuming work");
    expect(prompt).toContain("Implemented user login");
    expect(prompt).toContain("abc123");
    expect(prompt).toContain("Dashboard layout");
    expect(prompt).toContain("Check responsive grid");
    expect(prompt).toContain("Verify sidebar");
    expect(prompt).toContain("Flaky CI");
    expect(prompt).toContain("Check the login redirect");
    expect(prompt).toContain("Do not begin implementing");
    // Default orientation steps should NOT reference workspace-specific files
    expect(prompt).not.toContain("claude-progress.txt");
    expect(prompt).not.toContain("./init.sh");
  });

  it("buildResumePrompt() accepts custom orientation steps", () => {
    const artifact = {
      sessionId: "s1",
      previousSessionId: null,
      mode: "init" as const,
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T01:00:00.000Z",
      agentVersion: "1.1.1",
      progress: { featuresAttempted: [], featuresPassed: [], featuresFailed: [], summary: "Done" },
      environment: { workingDirectory: "/app", gitCommitHash: null, gitBranch: null, serverRunning: false, lastSmokeTestPassed: false, lastSmokeTestAt: null },
      nextSession: { suggestedFirstAction: "Start", blockers: [], nextFeatureId: null },
      handoffNotes: "",
    };

    const customSteps = ["Run `make setup`", "Check `docker ps`"];
    const prompt = ContextReset.buildResumePrompt(artifact, null, customSteps);

    expect(prompt).toContain("Run `make setup`");
    expect(prompt).toContain("Check `docker ps`");
  });

  it("buildResumePrompt() handles null nextFeature", () => {
    const artifact = {
      sessionId: "test-session",
      previousSessionId: null,
      mode: "init" as const,
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T01:00:00.000Z",
      agentVersion: "1.1.1",
      progress: {
        featuresAttempted: [],
        featuresPassed: [],
        featuresFailed: [],
        summary: "No work done",
      },
      environment: {
        workingDirectory: "/app",
        gitCommitHash: null,
        gitBranch: null,
        serverRunning: false,
        lastSmokeTestPassed: false,
        lastSmokeTestAt: null,
      },
      nextSession: {
        suggestedFirstAction: "Start work",
        blockers: [],
        nextFeatureId: null,
      },
      handoffNotes: "",
    };

    const prompt = ContextReset.buildResumePrompt(artifact, null);
    expect(prompt).toContain("resuming work");
    expect(prompt).not.toContain("NEXT FEATURE TO IMPLEMENT");
    expect(prompt).toContain("None");
  });
});
