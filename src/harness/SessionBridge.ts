// ============================================================
// @oni.bot/core/harness — SessionBridge
// ============================================================
// Cross-session memory primitive. Serializes complete agent
// state at session end, deserializes at session start. Sessions
// without a prior artifact run in 'init' mode; sessions that
// find one run in 'resume' mode.
// ============================================================

import { resolve, join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { randomId, atomicWriteJSON, readJSON, ensureDir, sanitizeForPrompt } from "./utils.js";
import { SessionBridgeNotOpenError } from "./errors.js";

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

export type SessionMode = "init" | "resume";

export interface SessionArtifact {
  sessionId: string;
  previousSessionId: string | null;
  mode: SessionMode;
  startedAt: string;
  endedAt: string | null;
  agentVersion: string;

  progress: {
    featuresAttempted: string[];
    featuresPassed: string[];
    featuresFailed: string[];
    summary: string;
  };

  environment: {
    workingDirectory: string;
    gitCommitHash: string | null;
    gitBranch: string | null;
    serverRunning: boolean;
    lastSmokeTestPassed: boolean;
    lastSmokeTestAt: string | null;
  };

  nextSession: {
    suggestedFirstAction: string;
    blockers: string[];
    nextFeatureId: string | null;
  };

  handoffNotes: string;
}

// ----------------------------------------------------------------
// SessionBridge
// ----------------------------------------------------------------

export class SessionBridge {
  private readonly artifactDir: string;
  private currentSessionId: string | null = null;
  private previousSessionId: string | null = null;
  private startedAt: string | null = null;
  private opened = false;

  constructor(artifactDir: string) {
    this.artifactDir = resolve(artifactDir);
  }

  /**
   * Called at the very start of any session.
   * Returns 'init' if no prior artifact exists, 'resume' if one does.
   */
  async open(): Promise<{ mode: SessionMode; artifact: SessionArtifact | null }> {
    ensureDir(this.artifactDir);

    const lastArtifact = this.findLatestArtifact();
    this.currentSessionId = randomId();
    this.startedAt = new Date().toISOString();
    this.opened = true;

    if (lastArtifact) {
      this.previousSessionId = lastArtifact.sessionId;
      return { mode: "resume", artifact: lastArtifact };
    }

    this.previousSessionId = null;
    return { mode: "init", artifact: null };
  }

  /**
   * Writes the artifact to disk at session end.
   * Throws if session was never opened.
   */
  async close(
    progress: SessionArtifact["progress"],
    handoffNotes: string,
    environment?: Partial<SessionArtifact["environment"]>,
    nextSession?: Partial<SessionArtifact["nextSession"]>,
  ): Promise<SessionArtifact> {
    if (!this.opened || !this.currentSessionId || !this.startedAt) {
      throw new SessionBridgeNotOpenError();
    }

    const artifact: SessionArtifact = {
      sessionId: this.currentSessionId,
      previousSessionId: this.previousSessionId,
      mode: this.previousSessionId ? "resume" : "init",
      startedAt: this.startedAt,
      endedAt: new Date().toISOString(),
      agentVersion: "1.1.1", // matches package.json

      progress,

      environment: {
        workingDirectory: process.cwd(),
        gitCommitHash: environment?.gitCommitHash ?? null,
        gitBranch: environment?.gitBranch ?? null,
        serverRunning: environment?.serverRunning ?? false,
        lastSmokeTestPassed: environment?.lastSmokeTestPassed ?? false,
        lastSmokeTestAt: environment?.lastSmokeTestAt ?? null,
      },

      nextSession: {
        suggestedFirstAction: nextSession?.suggestedFirstAction ?? "Review progress and continue with next feature",
        blockers: nextSession?.blockers ?? [],
        nextFeatureId: nextSession?.nextFeatureId ?? null,
      },

      handoffNotes,
    };

    const filePath = join(this.artifactDir, `session-${this.currentSessionId}.json`);
    atomicWriteJSON(filePath, artifact);

    this.opened = false;
    return artifact;
  }

  /**
   * Returns the last N artifacts for debugging/inspection.
   * Sorted newest first by timestamp (not by filename).
   */
  async history(n = 10): Promise<SessionArtifact[]> {
    const allArtifacts = this.readAllArtifacts();

    // Sort newest first by endedAt (or startedAt as fallback)
    allArtifacts.sort((a, b) => {
      const timeA = a.endedAt ?? a.startedAt;
      const timeB = b.endedAt ?? b.startedAt;
      return timeB.localeCompare(timeA);
    });

    return allArtifacts.slice(0, n);
  }

  /**
   * Returns a compact string summary suitable for injecting into a new agent's context.
   * Deterministic and token-efficient.
   *
   * All artifact-sourced text is sanitized before injection.
   */
  async contextSummary(): Promise<string> {
    const lastArtifact = this.findLatestArtifact();
    if (!lastArtifact) {
      return "=== SESSION CONTEXT ===\nMode: init\nNo prior sessions found.\n======================";
    }

    const lines: string[] = [
      "=== SESSION CONTEXT ===",
      "Mode: resume",
      `Previous session completed: ${sanitizeForPrompt(lastArtifact.progress.summary)}`,
    ];

    if (lastArtifact.nextSession.blockers.length > 0) {
      const sanitizedBlockers = lastArtifact.nextSession.blockers
        .map(b => sanitizeForPrompt(b));
      lines.push(`BLOCKERS: ${sanitizedBlockers.join("; ")}`);
    }

    const env = lastArtifact.environment;
    const healthStr = env.lastSmokeTestPassed ? "healthy" : "UNHEALTHY";
    lines.push(`Environment: ${healthStr}`);

    if (lastArtifact.nextSession.nextFeatureId) {
      lines.push(`Next feature ID: ${lastArtifact.nextSession.nextFeatureId}`);
    }

    lines.push(`Suggested first action: ${sanitizeForPrompt(lastArtifact.nextSession.suggestedFirstAction)}`);

    if (lastArtifact.handoffNotes) {
      lines.push(`Handoff notes: ${sanitizeForPrompt(lastArtifact.handoffNotes)}`);
    }

    lines.push("======================");
    return lines.join("\n");
  }

  // ---- Internal ----

  private readAllArtifacts(): SessionArtifact[] {
    if (!existsSync(this.artifactDir)) return [];

    const files = readdirSync(this.artifactDir)
      .filter(f => f.startsWith("session-") && f.endsWith(".json"));

    const artifacts: SessionArtifact[] = [];
    for (const file of files) {
      const data = readJSON<SessionArtifact>(join(this.artifactDir, file));
      if (data) artifacts.push(data);
    }
    return artifacts;
  }

  private findLatestArtifact(): SessionArtifact | null {
    const artifacts = this.readAllArtifacts();
    if (artifacts.length === 0) return null;

    // Find the one with the latest endedAt (or startedAt as fallback)
    let latest: SessionArtifact | null = null;
    let latestTime = "";

    for (const artifact of artifacts) {
      const time = artifact.endedAt ?? artifact.startedAt;
      if (time > latestTime) {
        latestTime = time;
        latest = artifact;
      }
    }

    return latest;
  }
}
