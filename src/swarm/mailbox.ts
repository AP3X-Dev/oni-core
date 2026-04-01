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

/**
 * Sanitize a string for safe embedding in LLM context.
 * Strips characters / sequences that could be used for prompt injection.
 */
function sanitize(input: string): string {
  const withoutControls = [...input]
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join("");
  return withoutControls
    .replace(/[<>]/g, "")           // strip angle brackets to prevent tag injection
    .replace(/\r?\n{3,}/g, "\n\n"); // collapse excessive newlines
}

/** Format inbox as readable string for LLM context */
export function formatInbox(messages: SwarmMessage[]): string {
  if (!messages.length) return "(no messages)";
  return messages
    .map((m) => {
      const from    = sanitize(m.from);
      const replyTo = m.replyTo ? sanitize(m.replyTo) : "";
      const content = sanitize(m.content);
      const header  = `[From: ${from}]${replyTo ? ` [Re: ${replyTo}]` : ""}`;
      return `<swarm-message>\n${header}\n${content}\n</swarm-message>`;
    })
    .join("\n---\n");
}
