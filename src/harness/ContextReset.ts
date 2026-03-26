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
import { execGit, sanitizeForPrompt } from "./utils.js";

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

  /**
   * Custom orientation steps for the resume prompt.
   * Replaces the default "first actions" list. If omitted, a generic
   * set of orientation steps is used (no workspace-specific commands).
   */
  orientationSteps?: string[];
}

export interface ResetResult {
  newSessionId: string;
  artifact: SessionArtifact;
  contextSummary: string;
}

// Default orientation steps — generic, no workspace-specific assumptions
const DEFAULT_ORIENTATION_STEPS = [
  "Run `pwd` to confirm your working directory",
  "Read the git log: `git log --oneline -10`",
  "Check git status: `git status`",
  "Review any progress/status files in the project root",
  "Run the smoke test to verify environment health",
];

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
    const { bridge, registry, commitBeforeReset } = this.config;

    // Optionally commit workspace state before reset
    if (commitBeforeReset) {
      const cwd = process.cwd();
      try {
        execGit(["add", "-A"], cwd);
        const status = execGit(["status", "--porcelain"], cwd);
        if (status && status.length > 0) {
          execGit(["commit", "-m", "chore(oni): pre-reset checkpoint"], cwd);
        }
      } catch {
        // Git commit failure should not block the reset
      }
    }

    // Gather environment state
    const cwd = process.cwd();
    let gitCommitHash: string | null = null;
    let gitBranch: string | null = null;
    try {
      gitCommitHash = execGit(["rev-parse", "HEAD"], cwd);
      gitBranch = execGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
    } catch {
      // git not available or not a repo
    }

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
    const contextSummary = ContextReset.buildResumePrompt(
      artifact,
      nextFeature,
      this.config.orientationSteps,
    );

    return {
      newSessionId: artifact.sessionId,
      artifact,
      contextSummary,
    };
  }

  /**
   * Returns a system prompt fragment that orients a fresh agent.
   * Suitable for injection as the first message in a new context.
   *
   * All artifact-sourced text is sanitized before injection to prevent
   * prompt injection from stored content.
   */
  static buildResumePrompt(
    artifact: SessionArtifact,
    nextFeature: Feature | null,
    orientationSteps?: string[],
  ): string {
    const steps = orientationSteps ?? DEFAULT_ORIENTATION_STEPS;

    const lines: string[] = [
      "You are resuming work on an ongoing software project.",
      "",
      "PRIOR SESSION SUMMARY:",
      sanitizeForPrompt(artifact.progress.summary),
      "",
      "ENVIRONMENT STATE:",
      `- Working directory: ${sanitizeForPrompt(artifact.environment.workingDirectory)}`,
      `- Git commit: ${artifact.environment.gitCommitHash ?? "unknown"}`,
      `- Last smoke test: ${artifact.environment.lastSmokeTestPassed ? "passed" : "failed"} at ${artifact.environment.lastSmokeTestAt ?? "unknown"}`,
      "",
      "YOUR FIRST ACTIONS (do these before anything else):",
    ];

    for (let i = 0; i < steps.length; i++) {
      lines.push(`${i + 1}. ${steps[i]}`);
    }

    if (nextFeature) {
      lines.push(
        "",
        "NEXT FEATURE TO IMPLEMENT:",
        `[${nextFeature.id}] ${sanitizeForPrompt(nextFeature.description)} (priority: ${nextFeature.priority})`,
        "",
        "Verification steps:",
      );
      for (let i = 0; i < nextFeature.steps.length; i++) {
        lines.push(`${i + 1}. ${sanitizeForPrompt(nextFeature.steps[i]!)}`);
      }
    }

    const blockers = artifact.nextSession.blockers;
    lines.push(
      "",
      "BLOCKERS FROM PRIOR SESSION:",
      blockers.length > 0 ? blockers.map(b => sanitizeForPrompt(b)).join("\n") : "None",
    );

    lines.push(
      "",
      "HANDOFF NOTES:",
      artifact.handoffNotes ? sanitizeForPrompt(artifact.handoffNotes) : "None",
      "",
      "Do not begin implementing until you have completed the orientation steps above.",
    );

    return lines.join("\n");
  }
}
