// ============================================================
// @oni.bot/core/harness/loop — Hooks
// HooksEngine wiring using actual payload types from hooks-engine.ts.
// ============================================================

import type { HooksEngine, HookResult } from "../hooks-engine.js";

// ─── fireSessionStart ───────────────────────────────────────────────────────

export async function fireSessionStart(
  hooksEngine: HooksEngine,
  sessionId: string,
  agentName: string,
  toolNames: string[],
): Promise<HookResult | null> {
  return hooksEngine.fire("SessionStart", {
    sessionId,
    agentName,
    tools: toolNames,
  });
}

// ─── fireSessionEnd ─────────────────────────────────────────────────────────

export async function fireSessionEnd(
  hooksEngine: HooksEngine,
  sessionId: string,
  reason: string,
  turns: number,
): Promise<void> {
  await hooksEngine.fire("SessionEnd", {
    sessionId,
    reason,
    turns,
  });
}

// ─── fireStop ───────────────────────────────────────────────────────────────

export async function fireStop(
  hooksEngine: HooksEngine,
  sessionId: string,
  response: string,
): Promise<HookResult | null> {
  return hooksEngine.fire("Stop", {
    sessionId,
    response,
  });
}

// ─── firePreCompact ─────────────────────────────────────────────────────────

export async function firePreCompact(
  hooksEngine: HooksEngine,
  sessionId: string,
  messageCount: number,
  estimatedTokens: number,
): Promise<void> {
  await hooksEngine.fire("PreCompact", {
    sessionId,
    messageCount,
    estimatedTokens,
  });
}

// ─── firePostCompact ────────────────────────────────────────────────────────

export async function firePostCompact(
  hooksEngine: HooksEngine,
  sessionId: string,
  beforeCount: number,
  afterCount: number,
  estimatedTokensAfter: number,
  summarized: boolean,
): Promise<void> {
  await hooksEngine.fire("PostCompact", {
    sessionId,
    beforeCount,
    afterCount,
    estimatedTokensAfter,
    summarized,
  });
}
