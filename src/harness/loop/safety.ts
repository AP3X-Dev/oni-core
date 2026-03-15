// ============================================================
// @oni.bot/core/harness/loop — Safety
// SafetyGate check integration.
// ============================================================

import type { SafetyGate, SafetyCheckResult } from "../safety-gate.js";

// ─── checkSafety ────────────────────────────────────────────────────────────

/**
 * Run a safety gate check for a tool call.
 * Returns the check result, or null if no gate is configured or the tool
 * does not require a check.
 */
export async function checkSafety(
  safetyGate: SafetyGate | undefined,
  toolCallId: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
): Promise<SafetyCheckResult | null> {
  if (!safetyGate || !safetyGate.requiresCheck(toolName)) {
    return null;
  }

  return safetyGate.check({
    id: toolCallId,
    name: toolName,
    args: toolArgs,
  });
}
