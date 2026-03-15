// ============================================================
// @oni.bot/core/harness/loop — Internal types
// Shared types used across the loop sub-modules.
// ============================================================

// Re-export the public types that sub-modules need to reference,
// so callers import from one place.
export type {
  AgentLoopConfig,
  LoopMessage,
  LoopMessageType,
  LoopToolResult,
  HarnessToolContext,
  SessionOutcome,
} from "../types.js";

export type {
  ONIModelMessage,
  ChatResponse,
  LLMToolDef,
} from "../../models/types.js";

export type { ToolDefinition } from "../../tools/types.js";

export { generateId } from "../types.js";

// ─── makeMessage ─────────────────────────────────────────────────────────────
// Single canonical factory shared by all loop sub-modules.

import type { LoopMessage, LoopMessageType } from "../types.js";

export function makeMessage(
  type: LoopMessageType,
  sessionId: string,
  turn: number,
  overrides: Partial<LoopMessage> = {},
): LoopMessage {
  return { type, sessionId, turn, timestamp: Date.now(), ...overrides };
}
