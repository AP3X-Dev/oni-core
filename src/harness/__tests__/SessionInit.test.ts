import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runSessionInit } from "../SessionInit.js";
import { SessionBridge } from "../SessionBridge.js";
import { FeatureRegistry } from "../FeatureRegistry.js";
import { EnvironmentUnhealthyError } from "../errors.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "oni-si-test-"));
}

const SAMPLE_FEATURES = [
  {
    category: "functional" as const,
    description: "User authentication",
    priority: 1,
    steps: ["Login with valid credentials", "Verify session token"],
  },
  {
    category: "visual" as const,
    description: "Responsive layout",
    priority: 2,
    steps: ["Resize to mobile", "Check layout"],
  },
];

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

describe("runSessionInit", () => {
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

  it("returns init mode on first session", async () => {
    const bridge = new SessionBridge(bridgeDir);
    const registry = new FeatureRegistry(registryPath);
    await registry.initialize(SAMPLE_FEATURES);

    const result = await runSessionInit({ bridge, registry });

    expect(result.mode).toBe("init");
    expect(result.artifact).toBeNull();
    expect(result.nextFeature).not.toBeNull();
    expect(result.nextFeature!.description).toBe("User authentication");
    expect(result.smokeTestSkipped).toBe(true);
    expect(result.contextSummary).toContain("init");
  });

  it("returns resume mode with prior artifact", async () => {
    const bridge1 = new SessionBridge(bridgeDir);
    await bridge1.open();
    await bridge1.close(
      {
        featuresAttempted: ["f1"],
        featuresPassed: ["f1"],
        featuresFailed: [],
        summary: "Completed auth feature",
      },
      "Continue with layout",
    );

    const bridge2 = new SessionBridge(bridgeDir);
    const registry = new FeatureRegistry(registryPath);
    await registry.initialize(SAMPLE_FEATURES);

    const result = await runSessionInit({ bridge: bridge2, registry });

    expect(result.mode).toBe("resume");
    expect(result.artifact).not.toBeNull();
    expect(result.artifact!.progress.summary).toBe("Completed auth feature");
  });

  it("runs smoke test when resuming and provided", async () => {
    // Create a prior session
    const bridge1 = new SessionBridge(bridgeDir);
    await bridge1.open();
    await bridge1.close(
      { featuresAttempted: [], featuresPassed: [], featuresFailed: [], summary: "initial" },
      "notes",
    );

    const bridge2 = new SessionBridge(bridgeDir);
    const registry = new FeatureRegistry(registryPath);
    await registry.initialize(SAMPLE_FEATURES);

    const smokeTest = vi.fn().mockResolvedValue(true);

    const result = await runSessionInit({
      bridge: bridge2,
      registry,
      smokeTest,
    });

    expect(smokeTest).toHaveBeenCalled();
    expect(result.environmentHealthy).toBe(true);
    expect(result.smokeTestSkipped).toBe(false);
  });

  it("skips smoke test on init mode", async () => {
    const bridge = new SessionBridge(bridgeDir);
    const registry = new FeatureRegistry(registryPath);
    await registry.initialize(SAMPLE_FEATURES);

    const smokeTest = vi.fn().mockResolvedValue(true);

    const result = await runSessionInit({
      bridge,
      registry,
      smokeTest,
    });

    // Smoke test is only run on resume, not init
    expect(smokeTest).not.toHaveBeenCalled();
    expect(result.smokeTestSkipped).toBe(true);
  });

  it("throws EnvironmentUnhealthyError when smoke test fails and onBrokenEnvironment='throw'", async () => {
    const bridge1 = new SessionBridge(bridgeDir);
    await bridge1.open();
    await bridge1.close(
      { featuresAttempted: [], featuresPassed: [], featuresFailed: [], summary: "prior" },
      "notes",
    );

    const bridge2 = new SessionBridge(bridgeDir);
    const registry = new FeatureRegistry(registryPath);
    await registry.initialize(SAMPLE_FEATURES);

    await expect(
      runSessionInit({
        bridge: bridge2,
        registry,
        smokeTest: async () => false,
        onBrokenEnvironment: "throw",
      }),
    ).rejects.toThrow(EnvironmentUnhealthyError);
  });

  it("warns when smoke test fails and onBrokenEnvironment='warn'", async () => {
    const bridge1 = new SessionBridge(bridgeDir);
    await bridge1.open();
    await bridge1.close(
      { featuresAttempted: [], featuresPassed: [], featuresFailed: [], summary: "prior" },
      "notes",
    );

    const bridge2 = new SessionBridge(bridgeDir);
    const registry = new FeatureRegistry(registryPath);
    await registry.initialize(SAMPLE_FEATURES);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await runSessionInit({
      bridge: bridge2,
      registry,
      smokeTest: async () => false,
      onBrokenEnvironment: "warn",
    });

    expect(result.environmentHealthy).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("unhealthy"));
    warnSpy.mockRestore();
  });

  it("calls environmentFixer when smoke test fails and onBrokenEnvironment='fix'", async () => {
    const bridge1 = new SessionBridge(bridgeDir);
    await bridge1.open();
    await bridge1.close(
      { featuresAttempted: [], featuresPassed: [], featuresFailed: [], summary: "prior" },
      "notes",
    );

    const bridge2 = new SessionBridge(bridgeDir);
    const registry = new FeatureRegistry(registryPath);
    await registry.initialize(SAMPLE_FEATURES);

    let callCount = 0;
    const smokeTest = vi.fn(async () => {
      callCount++;
      return callCount > 1; // Fails first, passes after fix
    });

    const fixer = vi.fn().mockResolvedValue(undefined);

    const result = await runSessionInit({
      bridge: bridge2,
      registry,
      smokeTest,
      onBrokenEnvironment: "fix",
      environmentFixer: fixer,
    });

    expect(fixer).toHaveBeenCalled();
    expect(result.environmentHealthy).toBe(true);
  });

  it("context summary includes feature verification steps", async () => {
    const bridge = new SessionBridge(bridgeDir);
    const registry = new FeatureRegistry(registryPath);
    await registry.initialize(SAMPLE_FEATURES);

    const result = await runSessionInit({ bridge, registry });

    expect(result.contextSummary).toContain("User authentication");
    expect(result.contextSummary).toContain("Login with valid credentials");
    expect(result.contextSummary).toContain("Verify session token");
  });

  it("handles uninitialized registry gracefully", async () => {
    const bridge = new SessionBridge(bridgeDir);
    const registry = new FeatureRegistry(registryPath);
    // Deliberately NOT initializing the registry

    const result = await runSessionInit({ bridge, registry });

    expect(result.nextFeature).toBeNull();
    expect(result.contextSummary).toContain("none");
  });
});
