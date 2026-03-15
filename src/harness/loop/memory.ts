// ============================================================
// @oni.bot/core/harness/loop — Memory
// MemoryLoader wake/orient/match integration.
// ============================================================

import { MemoryLoader } from "../memory-loader.js";
import type { AgentLoopConfig } from "../types.js";
import type { SessionOutcome } from "../types.js";

// ─── initMemory ─────────────────────────────────────────────────────────────

export interface MemoryInitResult {
  memoryLoader: MemoryLoader | null;
  memoryContext: string;
}

/**
 * Initialize MemoryLoader and run wake/orient/match if configured.
 * Returns the loader instance and the built system prompt prefix.
 */
export function initMemory(prompt: string, config: AgentLoopConfig): MemoryInitResult {
  const memoryLoader = config.memoryRoot
    ? MemoryLoader.fromRoot(config.memoryRoot, {
        budgets: config.memoryBudgets,
        debug: config.memoryDebug,
      })
    : null;

  let memoryContext = "";
  if (memoryLoader && !config.signal?.aborted) {
    memoryLoader.wake();
    memoryLoader.orient();
    const t2 = memoryLoader.match(prompt);
    if (config.memoryDebug && t2.dropped.length > 0) {
      console.log(`[MemoryLoader] match() dropped ${t2.dropped.length} units over T2 budget`);
    }
    memoryContext = memoryLoader.buildSystemPrompt([0, 1, 2]);
  }

  return { memoryLoader, memoryContext };
}

// ─── finalizeMemory ─────────────────────────────────────────────────────────

/**
 * buildEpisodicLog — Assemble session log for persistEpisodic().
 *
 * Uses compactor.getLastSummary() for ## What Happened when available,
 * falling back to the raw task description.
 */
export function buildEpisodicLog(
  sessionId: string,
  taskDescription: string,
  turnCount: number,
  outcome: SessionOutcome,
  compactor?: import("../context-compactor.js").ContextCompactor,
): string {
  const sessionContext = compactor?.getLastSummary() ?? null;
  const openThreads = compactor?.getOpenThreads().join("\n") ?? "none";

  const outcomeNote =
    outcome === "budget-exceeded"
      ? "Session ended at turn limit. Task may be incomplete — check Open Threads before assuming prior work is done."
      : "";

  return [
    `---`,
    `type: episodic`,
    `session: ${sessionId}`,
    `outcome: ${outcome}`,
    `turns: ${turnCount}`,
    `created: ${new Date().toISOString()}`,
    `---`,
    ``,
    `## What Happened`,
    sessionContext ?? taskDescription,
    ``,
    `## Turns`,
    String(turnCount),
    ``,
    `## Outcome`,
    outcome,
    ...(outcomeNote ? [``, outcomeNote] : []),
    ``,
    `## Open Threads`,
    openThreads,
  ].join("\n");
}

/** Persist episodic memory and reset session state. */
export function finalizeMemory(
  memoryLoader: MemoryLoader | null,
  sessionId: string,
  prompt: string,
  turn: number,
  sessionOutcome: SessionOutcome,
  config: AgentLoopConfig,
): void {
  if (memoryLoader) {
    const log = buildEpisodicLog(sessionId, prompt, turn, sessionOutcome, config.compactor);
    memoryLoader.persistEpisodic(sessionId, log);
    memoryLoader.resetSession();
  }
}
