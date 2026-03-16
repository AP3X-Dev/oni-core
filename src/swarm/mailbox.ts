// ============================================================
// @oni.bot/core/swarm — Mailbox (async inter-agent messaging)
// ============================================================
// Agents communicate by posting messages to the shared mailbox.
// Each message is addressed to a specific agent ID or "*" for
// broadcast. Consumers pull their inbox by agent ID.
// ============================================================

import { randomUUID } from "node:crypto";
import type { SwarmMessage } from "./types.js";

export function createMessage(
  from:      string,
  to:        string,
  content:   string,
  opts?: { metadata?: Record<string, unknown>; replyTo?: string }
): SwarmMessage {
  return {
    id:        `msg-${randomUUID()}`,
    from,
    to,
    content,
    metadata:  opts?.metadata,
    replyTo:   opts?.replyTo,
    timestamp: Date.now(),
  };
}

/** Extract messages addressed to a specific agent (or broadcasts) */
export function getInbox(messages: SwarmMessage[], agentId: string): SwarmMessage[] {
  return messages.filter((m) => m.to === agentId || m.to === "*");
}

/** Mark messages as consumed — returns messages NOT consumed by agentId */
export function consumeInbox(messages: SwarmMessage[], agentId: string): SwarmMessage[] {
  // Only remove direct messages addressed to this agent.
  // Broadcasts (to === "*") are preserved so subsequent agents can still read them.
  return messages.filter((m) => m.to !== agentId);
}

/** Format inbox as readable string for LLM context */
export function formatInbox(messages: SwarmMessage[]): string {
  if (!messages.length) return "(no messages)";
  return messages
    .map((m) => `[From: ${m.from}]${m.replyTo ? ` [Re: ${m.replyTo}]` : ""}\n${m.content}`)
    .join("\n---\n");
}
