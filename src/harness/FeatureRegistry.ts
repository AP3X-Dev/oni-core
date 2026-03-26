// ============================================================
// @oni.bot/core/harness — FeatureRegistry
// ============================================================
// JSON-backed, append-only task registry. Agents read from it
// to know what to work on next. The ONLY mutation agents may
// perform is flipping `passes` and appending `failureNotes`.
// All other fields are immutable after initialization.
// ============================================================

import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { randomId, atomicWriteJSON, readJSON, withFileLock } from "./utils.js";
import {
  FeatureRegistryMutationError,
  FeatureRegistryAlreadyInitializedError,
  FeatureNotFoundError,
} from "./errors.js";

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

export interface Feature {
  readonly id: string;
  readonly category: "functional" | "visual" | "performance" | "security" | "ux";
  readonly description: string;
  readonly priority: number;
  readonly steps: string[];
  passes: boolean;
  passedAt?: string;
  failureNotes?: string;
}

export interface FeatureRegistrySnapshot {
  version: number;
  createdAt: string;
  updatedAt: string;
  features: Feature[];
}

export interface FeatureRegistrySummary {
  total: number;
  passing: number;
  failing: number;
  byCategory: Record<string, { total: number; passing: number; failing: number }>;
}

export type FeatureInit = Omit<Feature, "id" | "passes" | "passedAt">;

// ----------------------------------------------------------------
// Immutable fields — used to enforce mutation constraints
// ----------------------------------------------------------------

const IMMUTABLE_FIELDS: ReadonlySet<string> = new Set([
  "id", "category", "description", "priority", "steps", "passedAt",
]);

// ----------------------------------------------------------------
// FeatureRegistry
// ----------------------------------------------------------------

export class FeatureRegistry {
  private readonly filePath: string;
  private readonly lockPath: string;

  constructor(path: string) {
    this.filePath = resolve(path);
    this.lockPath = `${this.filePath}.lock`;
  }

  /**
   * Initializer agent calls this once to populate the registry.
   * Throws if the file already exists — prevents accidental overwrites.
   */
  async initialize(features: FeatureInit[]): Promise<void> {
    if (existsSync(this.filePath)) {
      throw new FeatureRegistryAlreadyInitializedError(this.filePath);
    }

    const now = new Date().toISOString();
    const snapshot: FeatureRegistrySnapshot = {
      version: 1,
      createdAt: now,
      updatedAt: now,
      features: features.map(f => ({
        id: randomId(),
        category: f.category,
        description: f.description,
        priority: f.priority,
        steps: f.steps,
        passes: false,
        failureNotes: f.failureNotes,
      })),
    };

    atomicWriteJSON(this.filePath, snapshot);
  }

  /**
   * Returns the next feature to work on: highest-priority feature that
   * is not yet passing. Returns null when all features pass.
   */
  async getNextFeature(): Promise<Feature | null> {
    const snapshot = this.readSnapshot();
    const failing = snapshot.features
      .filter(f => !f.passes)
      .sort((a, b) => a.priority - b.priority);
    return failing[0] ?? null;
  }

  /**
   * Returns all features in the registry.
   */
  async getAll(): Promise<Feature[]> {
    return this.readSnapshot().features;
  }

  /**
   * Returns a summary: total, passing, failing, by category.
   */
  async getSummary(): Promise<FeatureRegistrySummary> {
    const snapshot = this.readSnapshot();
    const byCategory: Record<string, { total: number; passing: number; failing: number }> = {};

    let passing = 0;
    let failing = 0;

    for (const f of snapshot.features) {
      if (f.passes) passing++;
      else failing++;

      if (!byCategory[f.category]) {
        byCategory[f.category] = { total: 0, passing: 0, failing: 0 };
      }
      const cat = byCategory[f.category]!;
      cat.total++;
      if (f.passes) cat.passing++;
      else cat.failing++;
    }

    return {
      total: snapshot.features.length,
      passing,
      failing,
      byCategory,
    };
  }

  /**
   * The ONLY mutation a coding agent may call.
   * Throws FeatureRegistryMutationError if any immutable field differs.
   * Throws FeatureNotFoundError if the feature ID doesn't exist.
   */
  async markResult(id: string, passes: boolean, failureNotes?: string): Promise<void> {
    await withFileLock(this.lockPath, async () => {
      const snapshot = this.readSnapshot();
      const idx = snapshot.features.findIndex(f => f.id === id);
      if (idx === -1) {
        throw new FeatureNotFoundError(id);
      }

      const feature = snapshot.features[idx]!;

      // Update allowed fields
      feature.passes = passes;
      if (passes) {
        feature.passedAt = new Date().toISOString();
        // Clear failure notes on pass
        feature.failureNotes = undefined;
      } else {
        // Clear passedAt when a feature fails again — prevents stale timestamps
        feature.passedAt = undefined;
        if (failureNotes !== undefined) {
          // Append failure notes, never overwrite
          feature.failureNotes = feature.failureNotes
            ? `${feature.failureNotes}\n---\n${failureNotes}`
            : failureNotes;
        }
      }

      snapshot.features[idx] = feature;
      snapshot.version++;
      snapshot.updatedAt = new Date().toISOString();
      atomicWriteJSON(this.filePath, snapshot);
    });
  }

  /**
   * Returns full snapshot for serialization into handoff artifacts.
   */
  async snapshot(): Promise<FeatureRegistrySnapshot> {
    return this.readSnapshot();
  }

  /**
   * Validates that a proposed update does not mutate immutable fields.
   * Exported for testing — agents should not call this directly.
   */
  static validateMutation(existing: Feature, update: Partial<Feature>): void {
    for (const field of IMMUTABLE_FIELDS) {
      const key = field as keyof Feature;
      if (key in update) {
        const existingVal = JSON.stringify(existing[key]);
        const updateVal = JSON.stringify(update[key]);
        if (existingVal !== updateVal) {
          throw new FeatureRegistryMutationError(existing.id, field);
        }
      }
    }
  }

  // ---- Internal ----

  private readSnapshot(): FeatureRegistrySnapshot {
    const data = readJSON<FeatureRegistrySnapshot>(this.filePath);
    if (!data) {
      throw new Error(`FeatureRegistry file not found at "${this.filePath}". Call initialize() first.`);
    }
    return data;
  }
}
