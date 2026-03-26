import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FeatureRegistry } from "../FeatureRegistry.js";
import {
  FeatureRegistryAlreadyInitializedError,
  FeatureRegistryMutationError,
  FeatureNotFoundError,
} from "../errors.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "oni-fr-test-"));
}

const SAMPLE_FEATURES = [
  {
    category: "functional" as const,
    description: "User login flow",
    priority: 1,
    steps: ["Enter credentials", "Click submit", "See dashboard"],
  },
  {
    category: "visual" as const,
    description: "Dark mode support",
    priority: 3,
    steps: ["Toggle theme", "Verify dark palette"],
  },
  {
    category: "security" as const,
    description: "Input sanitization",
    priority: 2,
    steps: ["Submit XSS payload", "Verify it is escaped"],
  },
];

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

describe("FeatureRegistry", () => {
  let tmpDir: string;
  let registryPath: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    registryPath = join(tmpDir, "features.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── initialize() ──

  it("initialize() creates the registry file with correct structure", async () => {
    const reg = new FeatureRegistry(registryPath);
    await reg.initialize(SAMPLE_FEATURES);

    const snapshot = await reg.snapshot();
    expect(snapshot.version).toBe(1);
    expect(snapshot.features).toHaveLength(3);
    expect(snapshot.createdAt).toBeTruthy();
    expect(snapshot.updatedAt).toBeTruthy();

    // All features start as not passing
    for (const f of snapshot.features) {
      expect(f.passes).toBe(false);
      expect(f.id).toBeTruthy();
    }
  });

  it("initialize() throws if already initialized", async () => {
    const reg = new FeatureRegistry(registryPath);
    await reg.initialize(SAMPLE_FEATURES);
    await expect(reg.initialize(SAMPLE_FEATURES)).rejects.toThrow(
      FeatureRegistryAlreadyInitializedError,
    );
  });

  // ── getNextFeature() ──

  it("getNextFeature() returns highest priority failing feature", async () => {
    const reg = new FeatureRegistry(registryPath);
    await reg.initialize(SAMPLE_FEATURES);

    const next = await reg.getNextFeature();
    expect(next).not.toBeNull();
    expect(next!.priority).toBe(1);
    expect(next!.description).toBe("User login flow");
  });

  it("getNextFeature() returns null when all pass", async () => {
    const reg = new FeatureRegistry(registryPath);
    await reg.initialize(SAMPLE_FEATURES);

    const all = await reg.getAll();
    for (const f of all) {
      await reg.markResult(f.id, true);
    }

    const next = await reg.getNextFeature();
    expect(next).toBeNull();
  });

  it("getNextFeature() skips already-passing features", async () => {
    const reg = new FeatureRegistry(registryPath);
    await reg.initialize(SAMPLE_FEATURES);

    const all = await reg.getAll();
    // Mark the priority-1 feature as passing
    const first = all.find(f => f.priority === 1)!;
    await reg.markResult(first.id, true);

    const next = await reg.getNextFeature();
    expect(next).not.toBeNull();
    expect(next!.priority).toBe(2);
  });

  // ── getAll() ──

  it("getAll() returns all features", async () => {
    const reg = new FeatureRegistry(registryPath);
    await reg.initialize(SAMPLE_FEATURES);

    const all = await reg.getAll();
    expect(all).toHaveLength(3);
  });

  // ── getSummary() ──

  it("getSummary() returns correct counts", async () => {
    const reg = new FeatureRegistry(registryPath);
    await reg.initialize(SAMPLE_FEATURES);

    const all = await reg.getAll();
    await reg.markResult(all[0]!.id, true);

    const summary = await reg.getSummary();
    expect(summary.total).toBe(3);
    expect(summary.passing).toBe(1);
    expect(summary.failing).toBe(2);
    expect(summary.byCategory["functional"]).toEqual({
      total: 1, passing: 1, failing: 0,
    });
  });

  // ── markResult() ──

  it("markResult() flips passes to true and sets passedAt", async () => {
    const reg = new FeatureRegistry(registryPath);
    await reg.initialize(SAMPLE_FEATURES);

    const all = await reg.getAll();
    const feature = all[0]!;
    await reg.markResult(feature.id, true);

    const updated = (await reg.getAll()).find(f => f.id === feature.id)!;
    expect(updated.passes).toBe(true);
    expect(updated.passedAt).toBeTruthy();
  });

  it("markResult() appends failureNotes without overwriting", async () => {
    const reg = new FeatureRegistry(registryPath);
    await reg.initialize(SAMPLE_FEATURES);

    const all = await reg.getAll();
    const feature = all[0]!;

    await reg.markResult(feature.id, false, "First failure");
    await reg.markResult(feature.id, false, "Second failure");

    const updated = (await reg.getAll()).find(f => f.id === feature.id)!;
    expect(updated.failureNotes).toContain("First failure");
    expect(updated.failureNotes).toContain("Second failure");
    expect(updated.failureNotes).toContain("---");
  });

  it("markResult() clears passedAt when a passing feature fails again", async () => {
    const reg = new FeatureRegistry(registryPath);
    await reg.initialize(SAMPLE_FEATURES);

    const all = await reg.getAll();
    const feature = all[0]!;

    // Mark as passing
    await reg.markResult(feature.id, true);
    let updated = (await reg.getAll()).find(f => f.id === feature.id)!;
    expect(updated.passedAt).toBeTruthy();

    // Mark as failing again — passedAt should be cleared
    await reg.markResult(feature.id, false, "Regression");
    updated = (await reg.getAll()).find(f => f.id === feature.id)!;
    expect(updated.passes).toBe(false);
    expect(updated.passedAt).toBeUndefined();
    expect(updated.failureNotes).toContain("Regression");
  });

  it("markResult() clears failureNotes on pass", async () => {
    const reg = new FeatureRegistry(registryPath);
    await reg.initialize(SAMPLE_FEATURES);

    const all = await reg.getAll();
    const feature = all[0]!;

    await reg.markResult(feature.id, false, "Some failure");
    await reg.markResult(feature.id, true);

    const updated = (await reg.getAll()).find(f => f.id === feature.id)!;
    expect(updated.passes).toBe(true);
    expect(updated.failureNotes).toBeUndefined();
  });

  it("markResult() throws for non-existent feature ID", async () => {
    const reg = new FeatureRegistry(registryPath);
    await reg.initialize(SAMPLE_FEATURES);

    await expect(reg.markResult("nonexistent-id", true)).rejects.toThrow(
      FeatureNotFoundError,
    );
  });

  it("markResult() increments version on each write", async () => {
    const reg = new FeatureRegistry(registryPath);
    await reg.initialize(SAMPLE_FEATURES);

    const all = await reg.getAll();
    await reg.markResult(all[0]!.id, true);
    expect((await reg.snapshot()).version).toBe(2);

    await reg.markResult(all[1]!.id, false, "fail");
    expect((await reg.snapshot()).version).toBe(3);
  });

  // ── Mutation enforcement ──

  it("validateMutation() throws on immutable field changes", () => {
    const feature = {
      id: "test-id",
      category: "functional" as const,
      description: "original",
      priority: 1,
      steps: ["step1"],
      passes: false,
    };

    expect(() => {
      FeatureRegistry.validateMutation(feature, { description: "changed" });
    }).toThrow(FeatureRegistryMutationError);

    expect(() => {
      FeatureRegistry.validateMutation(feature, { priority: 99 });
    }).toThrow(FeatureRegistryMutationError);

    expect(() => {
      FeatureRegistry.validateMutation(feature, { id: "different" });
    }).toThrow(FeatureRegistryMutationError);
  });

  it("validateMutation() rejects passedAt mutation", () => {
    const feature = {
      id: "test-id",
      category: "functional" as const,
      description: "original",
      priority: 1,
      steps: ["step1"],
      passes: true,
      passedAt: "2026-01-01T00:00:00.000Z",
    };

    expect(() => {
      FeatureRegistry.validateMutation(feature, { passedAt: "2099-01-01T00:00:00.000Z" });
    }).toThrow(FeatureRegistryMutationError);
  });

  it("validateMutation() allows passes and failureNotes changes", () => {
    const feature = {
      id: "test-id",
      category: "functional" as const,
      description: "original",
      priority: 1,
      steps: ["step1"],
      passes: false,
    };

    expect(() => {
      FeatureRegistry.validateMutation(feature, { passes: true });
    }).not.toThrow();

    expect(() => {
      FeatureRegistry.validateMutation(feature, { failureNotes: "some note" });
    }).not.toThrow();
  });

  // ── snapshot() ──

  it("snapshot() returns the full serializable snapshot", async () => {
    const reg = new FeatureRegistry(registryPath);
    await reg.initialize(SAMPLE_FEATURES);

    const snap = await reg.snapshot();
    expect(snap.version).toBe(1);
    expect(snap.features).toHaveLength(3);
    expect(typeof snap.createdAt).toBe("string");
    expect(typeof snap.updatedAt).toBe("string");
  });

  // ── Error when not initialized ──

  it("throws when reading uninitialized registry", async () => {
    const reg = new FeatureRegistry(registryPath);
    await expect(reg.getAll()).rejects.toThrow("not found");
  });
});
