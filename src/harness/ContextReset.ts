// ============================================================
// @oni.bot/core/harness — ContextReset
// ============================================================
// Performs a clean agent context reset. Distinct from compaction
// — this terminates the current agent entirely and starts a
// fresh one with a structured handoff.
// ============================================================

import type { SessionBridge, SessionArtifact } from "./SessionBridge.js";
import type { FeatureRegistry, Feature } from "./FeatureRegistry.js";
import type { WorkspaceCheckpointer } from "./WorkspaceCheckpointer.js";
import { execGit } from "./utils.js";

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

export interface ContextResetConfig {
  bridge: SessionBridge;
  registry: FeatureRegistry;
  checkpointer?: WorkspaceCheckpointer<Record<string, unknown>>;

  /** Token threshold at which a reset should be triggered (0-1). Default: 0.80 */
  autoResetThreshold?: number;

  /** If true, commits workspace state before reset */
  commitBeforeReset?: boolean;
}

export interface ResetResult {
  newSessionId: string;
  artifact: SessionArtifact;
  contextSummary: string;
}

// ----------------------------------------------------------------
// ContextReset
// ----------------------------------------------------------------

export class ContextReset {
  private readonly config: ContextResetConfig;
  private readonly autoResetThreshold: number;

  constructor(config: ContextResetConfig) {
    this.config = config;
    this.autoResetThreshold = config.autoResetThreshold ?? 0.80;
  }

  /**
   * Check if a reset should be triggered given current token usage.
   */
  shouldReset(currentTokens: number, maxTokens: number): boolean {
    if (maxTokens <= 0) return false;
    return (currentTokens / maxTokens) >= this.autoResetThreshold;
  }

  /**
   * Execute the reset:
   * 1. Optionally commit workspace state
   * 2. Close current session (writes artifact)
   * 3. Build context summary for the new agent
   */
  async execute(
    currentProgress: SessionArtifact["progress"],
    handoffNotes: string,
  ): Promise<ResetResult> {
    const { bridge, registry, checkpointer, commitBeforeReset } = this.config;

    // Optionally commit workspace state before reset
    if (commitBeforeReset) {
      const cwd = process.cwd();
      execGit("add -A", cwd);
      const status = execGit("status --porcelain", cwd);
      if (status && status.length > 0) {
        execGit('commit -m "chore(oni): pre-reset checkpoint"', cwd);
      }
    }

    // Gather environment state
    const cwd = process.cwd();
    const gitCommitHash = execGit("rev-parse HEAD", cwd);
    const gitBranch = execGit("rev-parse --abbrev-ref HEAD", cwd);

    // Resolve next feature for the new session
    let nextFeatureId: string | null = null;
    let nextFeature: Feature | null = null;
    try {
      nextFeature = await registry.getNextFeature();
      nextFeatureId = nextFeature?.id ?? null;
    } catch {
      // Registry may not exist
    }

    // Close current session
    const artifact = await bridge.close(
      currentProgress,
      handoffNotes,
      {
        gitCommitHash,
        gitBranch,
        serverRunning: false,
        lastSmokeTestPassed: false,
        lastSmokeTestAt: null,
      },
      {
        suggestedFirstAction: nextFeature
          ? `Implement feature: ${nextFeature.description}`
          : "Review progress and determine next steps",
        blockers: [],
        nextFeatureId,
      },
    );

    // Build context summary for the new agent
    const contextSummary = ContextReset.buildResumePrompt(artifact, nextFeature);

    return {
      newSessionId: artifact.sessionId,
      artifact,
      contextSummary,
    };
  }

  /**
   * Returns a system prompt fragment that orients a fresh agent.
   * Suitable for injection as the first message in a new context.
   */
  static buildResumePrompt(artifact: SessionArtifact, nextFeature: Feature | null): string {
    const lines: string[] = [
      "You are resuming work on an ongoing software project.",
      "",
      "PRIOR SESSION SUMMARY:",
      artifact.progress.summary,
      "",
      "ENVIRONMENT STATE:",
      `- Working directory: ${artifact.environment.workingDirectory}`,
      `- Git commit: ${artifact.environment.gitCommitHash ?? "unknown"}`,
      `- Last smoke test: ${artifact.environment.lastSmokeTestPassed ? "passed" : "failed"} at ${artifact.environment.lastSmokeTestAt ?? "unknown"}`,
      "",
      "YOUR FIRST ACTIONS (do these before anything else):",
      "1. Run `pwd` to confirm your working directory",
      "2. Read the git log: `git log --oneline -10`",
      "3. Read the progress file: `cat claude-progress.txt`",
      "4. Start the development server using `./init.sh`",
      "5. Run the smoke test to verify environment health",
    ];

    if (nextFeature) {
      lines.push(
        "",
        "NEXT FEATURE TO IMPLEMENT:",
        `[${nextFeature.id}] ${nextFeature.description} (priority: ${nextFeature.priority})`,
        "",
        "Verification steps:",
      );
      for (let i = 0; i < nextFeature.steps.length; i++) {
        lines.push(`${i + 1}. ${nextFeature.steps[i]}`);
      }
    }

    const blockers = artifact.nextSession.blockers;
    lines.push(
      "",
      "BLOCKERS FROM PRIOR SESSION:",
      blockers.length > 0 ? blockers.join("\n") : "None",
    );

    lines.push(
      "",
      "HANDOFF NOTES:",
      artifact.handoffNotes || "None",
      "",
      "Do not begin implementing until you have completed the orientation steps above.",
    );

    return lines.join("\n");
  }
}
