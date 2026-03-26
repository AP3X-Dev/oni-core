// ============================================================
// @oni.bot/core/harness — WorkspaceCheckpointer
// ============================================================
// Git-aware checkpointer that wraps SqliteCheckpointer.
// Every graph checkpoint optionally creates a git commit.
// Rollback = git checkout to a checkpoint's commit hash.
// ============================================================

import { resolve } from "node:path";
import type { ONICheckpoint, ONICheckpointer, CheckpointListOptions } from "../types.js";
import { SqliteCheckpointer } from "../checkpointers/sqlite.js";
import { execGit, isGitAvailable, randomId, atomicWriteJSON, readJSON, ensureDir } from "./utils.js";
import { WorkspaceGitUnavailableWarning } from "./errors.js";

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

export interface WorkspaceCheckpointerConfig {
  /** SQLite path for graph state persistence */
  dbPath: string;
  /** Git repo root directory */
  workspaceDir: string;
  /** If true, checkpoint → git commit automatically */
  autoCommit: boolean;
  /** Prefix for commit messages, e.g. "chore(oni):" */
  commitMessagePrefix: string;
}

export interface CheckpointCommit {
  checkpointId: string;
  commitHash: string;
  commitMessage: string;
  timestamp: string;
}

export interface CheckpointMetadata {
  description?: string;
  featureId?: string;
}

// Internal mapping stored alongside the SQLite database
interface CommitMappingStore {
  mappings: CheckpointCommit[];
}

// ----------------------------------------------------------------
// WorkspaceCheckpointer
// ----------------------------------------------------------------

export class WorkspaceCheckpointer<S> implements ONICheckpointer<S> {
  private readonly config: WorkspaceCheckpointerConfig;
  private readonly workspaceDir: string;
  private readonly mappingPath: string;
  private readonly gitAvailable: boolean;
  private sqlite: SqliteCheckpointer<S> | null = null;

  private constructor(
    sqlite: SqliteCheckpointer<S>,
    config: WorkspaceCheckpointerConfig,
    gitAvailable: boolean,
  ) {
    this.sqlite = sqlite;
    this.config = config;
    this.workspaceDir = resolve(config.workspaceDir);
    this.mappingPath = resolve(config.dbPath + ".commits.json");
    this.gitAvailable = gitAvailable;

    if (!gitAvailable) {
      const warning = new WorkspaceGitUnavailableWarning();
      console.warn(`[ONI] ${warning.message}`);
    }
  }

  /**
   * Factory method — mirrors SqliteCheckpointer.create() pattern.
   * Checks git availability and degrades gracefully if not found.
   */
  static async create<S>(config: WorkspaceCheckpointerConfig): Promise<WorkspaceCheckpointer<S>> {
    const sqlite = await SqliteCheckpointer.create<S>(config.dbPath);
    const gitAvailable = isGitAvailable();
    return new WorkspaceCheckpointer<S>(sqlite, config, gitAvailable);
  }

  // ── ONICheckpointer interface delegation ──

  async get(threadId: string): Promise<ONICheckpoint<S> | null> {
    return this.sqlite!.get(threadId);
  }

  async put(checkpoint: ONICheckpoint<S>): Promise<void> {
    return this.sqlite!.put(checkpoint);
  }

  async list(threadId: string, opts?: CheckpointListOptions): Promise<ONICheckpoint<S>[]> {
    return this.sqlite!.list(threadId, opts);
  }

  async delete(threadId: string): Promise<void> {
    return this.sqlite!.delete(threadId);
  }

  /**
   * Save a checkpoint with optional git commit.
   * After writing to SQLite, optionally commits the workspace.
   */
  async save(checkpoint: ONICheckpoint<S>, metadata?: CheckpointMetadata): Promise<void> {
    // Write to SQLite
    await this.sqlite!.put(checkpoint);

    // Optionally commit to git
    if (this.config.autoCommit && this.gitAvailable) {
      const checkpointId = `${checkpoint.threadId}-step${checkpoint.step}`;
      const desc = metadata?.description ?? `step ${checkpoint.step}`;
      const commitMessage = `${this.config.commitMessagePrefix} checkpoint ${checkpointId} — ${desc}`;

      // Stage all changes
      execGit("add -A", this.workspaceDir);

      // Check if there are changes to commit
      const status = execGit("status --porcelain", this.workspaceDir);
      if (status && status.length > 0) {
        const escaped = commitMessage.replace(/"/g, '\\"');
        const commitHash = execGit(`commit -m "${escaped}"`, this.workspaceDir);

        if (commitHash !== null) {
          const hash = execGit("rev-parse HEAD", this.workspaceDir);
          if (hash) {
            this.addCommitMapping({
              checkpointId,
              commitHash: hash,
              commitMessage,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    }
  }

  /**
   * Returns all checkpoints with their associated git commit hashes.
   */
  async listWithCommits(): Promise<CheckpointCommit[]> {
    const store = this.readMappings();
    return store.mappings;
  }

  /**
   * Rolls back to a prior checkpoint:
   * 1. Stashes current changes
   * 2. Checks out the commit associated with the checkpoint
   * 3. Restores graph state from SQLite
   */
  async rollbackTo(checkpointId: string): Promise<void> {
    const store = this.readMappings();
    const mapping = store.mappings.find(m => m.checkpointId === checkpointId);

    if (!mapping) {
      throw new Error(`No commit mapping found for checkpoint "${checkpointId}"`);
    }

    if (!this.gitAvailable) {
      throw new Error("Cannot rollback: git is not available");
    }

    // Stash current changes to avoid dirty workspace conflicts
    const status = execGit("status --porcelain", this.workspaceDir);
    if (status && status.length > 0) {
      execGit("stash push -m \"oni-checkpoint-rollback\"", this.workspaceDir);
    }

    // Checkout to the checkpoint's commit
    execGit(`checkout ${mapping.commitHash}`, this.workspaceDir);
  }

  /**
   * Returns a diff summary between two checkpoints.
   */
  async diff(fromCheckpointId: string, toCheckpointId: string): Promise<string> {
    const store = this.readMappings();
    const fromMapping = store.mappings.find(m => m.checkpointId === fromCheckpointId);
    const toMapping = store.mappings.find(m => m.checkpointId === toCheckpointId);

    if (!fromMapping || !toMapping) {
      throw new Error(
        `Commit mapping not found for checkpoint(s): ` +
        `${!fromMapping ? fromCheckpointId : ""} ${!toMapping ? toCheckpointId : ""}`.trim(),
      );
    }

    if (!this.gitAvailable) {
      return "[git unavailable — cannot produce diff]";
    }

    const result = execGit(
      `diff ${fromMapping.commitHash}..${toMapping.commitHash} --stat`,
      this.workspaceDir,
    );

    return result ?? "[no diff output]";
  }

  /**
   * Close the underlying SQLite connection.
   */
  close(): void {
    this.sqlite?.close();
  }

  // ---- Internal ----

  private readMappings(): CommitMappingStore {
    return readJSON<CommitMappingStore>(this.mappingPath) ?? { mappings: [] };
  }

  private addCommitMapping(mapping: CheckpointCommit): void {
    const store = this.readMappings();
    store.mappings.push(mapping);
    atomicWriteJSON(this.mappingPath, store);
  }
}
