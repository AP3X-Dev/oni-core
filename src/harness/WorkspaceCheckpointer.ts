// ============================================================
// @oni.bot/core/harness — WorkspaceCheckpointer
// ============================================================
// Git-aware checkpointer that wraps SqliteCheckpointer.
// Every graph checkpoint optionally creates a git commit.
// Rollback = git checkout + SQLite state restore.
//
// Git logic lives in put() — the method Pregel actually calls —
// not in a separate save() that the engine would never invoke.
// ============================================================

import { resolve } from "node:path";
import type { ONICheckpoint, ONICheckpointer, CheckpointListOptions } from "../types.js";
import { SqliteCheckpointer } from "../checkpointers/sqlite.js";
import { execGit, isGitAvailable, atomicWriteJSON, readJSON } from "./utils.js";
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

// Commit hashes are hex strings — validate before passing to git
const COMMIT_HASH_RE = /^[0-9a-f]{4,40}$/i;

// ----------------------------------------------------------------
// WorkspaceCheckpointer
// ----------------------------------------------------------------

export class WorkspaceCheckpointer<S> implements ONICheckpointer<S> {
  private readonly config: WorkspaceCheckpointerConfig;
  private readonly workspaceDir: string;
  private readonly mappingPath: string;
  private readonly gitAvailable: boolean;
  private sqlite: SqliteCheckpointer<S> | null = null;

  /** Optional metadata for the next put() — set via setNextMetadata() */
  private pendingMetadata: CheckpointMetadata | null = null;

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

    if (!gitAvailable && config.autoCommit) {
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

  /**
   * Set metadata that will be used by the next put() call.
   * This allows callers to attach a description/featureId before Pregel
   * calls put() through the standard ONICheckpointer interface.
   */
  setNextMetadata(metadata: CheckpointMetadata): void {
    this.pendingMetadata = metadata;
  }

  // ── ONICheckpointer interface ──

  async get(threadId: string): Promise<ONICheckpoint<S> | null> {
    return this.sqlite!.get(threadId);
  }

  /**
   * Write checkpoint to SQLite, then optionally commit workspace to git.
   * This is the method Pregel calls — git logic lives here, not in a
   * separate save() that the engine would never invoke.
   */
  async put(checkpoint: ONICheckpoint<S>): Promise<void> {
    await this.sqlite!.put(checkpoint);

    if (this.config.autoCommit && this.gitAvailable) {
      this.commitWorkspace(checkpoint);
    }

    // Consume pending metadata
    this.pendingMetadata = null;
  }

  async list(threadId: string, opts?: CheckpointListOptions): Promise<ONICheckpoint<S>[]> {
    return this.sqlite!.list(threadId, opts);
  }

  async delete(threadId: string): Promise<void> {
    return this.sqlite!.delete(threadId);
  }

  /**
   * Returns all checkpoints with their associated git commit hashes.
   */
  async listWithCommits(): Promise<CheckpointCommit[]> {
    return this.readMappings().mappings;
  }

  /**
   * Rolls back to a prior checkpoint:
   * 1. Stashes current changes to avoid dirty workspace conflicts
   * 2. Checks out the git commit associated with the checkpoint
   * 3. Truncates the SQLite checkpoint history so that `get(threadId)`
   *    returns the rolled-back checkpoint — not a later one.
   *
   * This is critical: Pregel resumes from whatever `get()` returns.
   * Simply reading the old checkpoint is not enough — later checkpoints
   * must be removed so the engine picks the correct one.
   *
   * Returns the restored checkpoint so callers can resume from it.
   */
  async rollbackTo(checkpointId: string): Promise<ONICheckpoint<S> | null> {
    const store = this.readMappings();
    const mapping = store.mappings.find(m => m.checkpointId === checkpointId);

    if (!mapping) {
      throw new Error(`No commit mapping found for checkpoint "${checkpointId}"`);
    }

    if (!this.gitAvailable) {
      throw new Error("Cannot rollback: git is not available");
    }

    // Validate commit hash before passing to git
    if (!COMMIT_HASH_RE.test(mapping.commitHash)) {
      throw new Error(`Invalid commit hash in mapping: "${mapping.commitHash}"`);
    }

    // Parse threadId and step from checkpointId
    // Format: "{threadId}-step{step}"
    const stepMatch = checkpointId.match(/-step(\d+)$/);
    if (!stepMatch) {
      throw new Error(`Cannot parse threadId/step from checkpointId: "${checkpointId}"`);
    }

    const threadId = checkpointId.slice(0, checkpointId.length - stepMatch[0].length);
    const targetStep = parseInt(stepMatch[1]!, 10);

    // Stash current changes to avoid dirty workspace conflicts
    try {
      const status = execGit(["status", "--porcelain"], this.workspaceDir);
      if (status && status.length > 0) {
        execGit(["stash", "push", "-m", "oni-checkpoint-rollback"], this.workspaceDir);
      }
    } catch {
      // Non-fatal: if stash fails, checkout may still work on a clean tree
    }

    // Checkout to the checkpoint's commit
    execGit(["checkout", mapping.commitHash], this.workspaceDir);

    // Truncate SQLite history: delete the thread, then re-insert only
    // checkpoints up to and including the target step.
    // This mirrors the pattern used by forkFrom() in pregel/checkpointing.ts.
    const allCheckpoints = await this.sqlite!.list(threadId);
    const kept = allCheckpoints.filter(cp => cp.step <= targetStep);

    await this.sqlite!.delete(threadId);
    for (const cp of kept) {
      await this.sqlite!.put(cp);
    }

    // Return the target checkpoint — now also what get(threadId) will return
    return kept.find(cp => cp.step === targetStep) ?? null;
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

    // Validate commit hashes
    if (!COMMIT_HASH_RE.test(fromMapping.commitHash) || !COMMIT_HASH_RE.test(toMapping.commitHash)) {
      throw new Error("Invalid commit hash in mapping");
    }

    const diffRange = `${fromMapping.commitHash}..${toMapping.commitHash}`;
    try {
      const result = execGit(["diff", diffRange, "--stat"], this.workspaceDir);
      return result ?? "[no diff output]";
    } catch {
      return "[git diff failed]";
    }
  }

  /**
   * Close the underlying SQLite connection.
   */
  close(): void {
    this.sqlite?.close();
  }

  // ---- Internal ----

  private commitWorkspace(checkpoint: ONICheckpoint<S>): void {
    const checkpointId = `${checkpoint.threadId}-step${checkpoint.step}`;
    const desc = this.pendingMetadata?.description ?? `step ${checkpoint.step}`;
    const commitMessage = `${this.config.commitMessagePrefix} checkpoint ${checkpointId} — ${desc}`;

    try {
      // Stage all changes
      execGit(["add", "-A"], this.workspaceDir);

      // Check if there are staged changes to commit
      const status = execGit(["status", "--porcelain"], this.workspaceDir);
      if (!status || status.length === 0) return;

      // Commit — message passed as argument, not interpolated into shell string
      execGit(["commit", "-m", commitMessage], this.workspaceDir);

      // Record the mapping
      const hash = execGit(["rev-parse", "HEAD"], this.workspaceDir);
      if (hash) {
        this.addCommitMapping({
          checkpointId,
          commitHash: hash,
          commitMessage,
          timestamp: new Date().toISOString(),
        });
      }
    } catch {
      // Git commit failure should not break checkpoint persistence.
      // The SQLite write already succeeded — log and continue.
      console.warn(`[ONI] git commit failed for checkpoint ${checkpointId}, continuing without git`);
    }
  }

  private readMappings(): CommitMappingStore {
    return readJSON<CommitMappingStore>(this.mappingPath) ?? { mappings: [] };
  }

  private addCommitMapping(mapping: CheckpointCommit): void {
    const store = this.readMappings();
    store.mappings.push(mapping);
    atomicWriteJSON(this.mappingPath, store);
  }
}
