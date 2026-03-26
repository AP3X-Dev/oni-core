// ============================================================
// @oni.bot/core/harness — SessionInit
// ============================================================
// Mandatory pre-flight hook that fires before any node executes
// in a resumed session. Standardizes the "get your bearings"
// ritual for agent coherence across context resets.
// ============================================================

import type { SessionBridge, SessionArtifact, SessionMode } from "./SessionBridge.js";
import type { FeatureRegistry, Feature } from "./FeatureRegistry.js";
import { EnvironmentUnhealthyError } from "./errors.js";

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

export interface SessionInitConfig {
  bridge: SessionBridge;
  registry: FeatureRegistry;
  smokeTest?: () => Promise<boolean>;
  smokeTestTimeoutMs?: number;
  onBrokenEnvironment?: "throw" | "warn" | "fix";
  environmentFixer?: () => Promise<void>;
}

export interface SessionInitResult {
  mode: SessionMode;
  artifact: SessionArtifact | null;
  nextFeature: Feature | null;
  environmentHealthy: boolean;
  smokeTestSkipped: boolean;
  contextSummary: string;
}

// ----------------------------------------------------------------
// runSessionInit
// ----------------------------------------------------------------

export async function runSessionInit(config: SessionInitConfig): Promise<SessionInitResult> {
  const {
    bridge,
    registry,
    smokeTest,
    smokeTestTimeoutMs = 30_000,
    onBrokenEnvironment = "throw",
    environmentFixer,
  } = config;

  // 1. Open SessionBridge — determine mode
  const { mode, artifact } = await bridge.open();

  // 2. Extract blockers/progress from prior artifact (if resuming)
  // (artifact is available for inspection but we just need mode + artifact here)

  // 3. Run smoke test if resuming and smokeTest is provided
  let environmentHealthy = true;
  let smokeTestSkipped = true;

  if (mode === "resume" && smokeTest) {
    smokeTestSkipped = false;
    try {
      environmentHealthy = await withTimeout(smokeTest(), smokeTestTimeoutMs);
    } catch {
      environmentHealthy = false;
    }

    // 4. Handle broken environment
    if (!environmentHealthy) {
      if (onBrokenEnvironment === "fix" && environmentFixer) {
        try {
          await environmentFixer();
          // Re-run smoke test after fix
          try {
            environmentHealthy = await withTimeout(smokeTest(), smokeTestTimeoutMs);
          } catch {
            environmentHealthy = false;
          }
        } catch {
          // Fixer itself failed
          environmentHealthy = false;
        }
      }

      if (!environmentHealthy && onBrokenEnvironment === "throw") {
        throw new EnvironmentUnhealthyError(
          `Smoke test failed during session init (mode: ${mode}). ` +
          (artifact
            ? `Previous session summary: ${artifact.progress.summary}`
            : "No prior session artifact."),
        );
      }

      if (!environmentHealthy && onBrokenEnvironment === "warn") {
        console.warn("[ONI] Smoke test failed. Environment may be unhealthy.");
      }
    }
  }

  // 5. Resolve next feature
  let nextFeature: Feature | null = null;
  try {
    nextFeature = await registry.getNextFeature();
  } catch {
    // Registry may not be initialized yet in init mode — that's OK
  }

  // 6. Build context summary
  const contextSummary = buildContextSummary(mode, artifact, nextFeature, environmentHealthy, smokeTestSkipped);

  return {
    mode,
    artifact,
    nextFeature,
    environmentHealthy,
    smokeTestSkipped,
    contextSummary,
  };
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function buildContextSummary(
  mode: SessionMode,
  artifact: SessionArtifact | null,
  nextFeature: Feature | null,
  environmentHealthy: boolean,
  smokeTestSkipped: boolean,
): string {
  const lines: string[] = [
    "=== SESSION CONTEXT ===",
    `Mode: ${mode}`,
  ];

  if (mode === "resume" && artifact) {
    lines.push(`Previous session completed: ${artifact.progress.summary}`);

    if (artifact.nextSession.blockers.length > 0) {
      lines.push(`BLOCKERS: ${artifact.nextSession.blockers.join("; ")}`);
    }
  }

  if (smokeTestSkipped) {
    lines.push("Environment: unknown (smoke test skipped)");
  } else {
    const healthStr = environmentHealthy ? "healthy" : "UNHEALTHY — was auto-fixed";
    lines.push(`Environment: ${healthStr}`);
  }

  if (nextFeature) {
    lines.push(`Next feature to work on: [${nextFeature.id}] ${nextFeature.description}`);
    lines.push("Verification steps:");
    for (let i = 0; i < nextFeature.steps.length; i++) {
      lines.push(`  ${i + 1}. ${nextFeature.steps[i]}`);
    }
  } else {
    lines.push("Next feature to work on: none (all features passing or registry empty)");
  }

  if (mode === "resume" && artifact) {
    lines.push(`Suggested first action: ${artifact.nextSession.suggestedFirstAction}`);
  }

  lines.push("======================");
  return lines.join("\n");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);
}
