// ============================================================
// @oni.bot/core/messages — addMessages reducer + RemoveMessage
// ============================================================
// A smart message channel that:
//   - Deduplicates by message ID (idempotent appends)
//   - Supports RemoveMessage to surgically delete by ID
//   - Supports UpdateMessage to patch an existing message
//   - Auto-generates IDs if not provided
// ============================================================

import { randomUUID } from "node:crypto";
import type { Channel } from "../types.js";

// ----------------------------------------------------------------
// Message with required ID
// ----------------------------------------------------------------

export interface BaseMessage {
  id?:           string;
  role:          "user" | "assistant" | "system" | "tool";
  content:       string;
  name?:         string;
  tool_call_id?: string;
  tool_calls?:   Array<{ id: string; name: string; args: Record<string, unknown> }>;
  /** Arbitrary metadata */
  metadata?:     Record<string, unknown>;
}

// Internal — always has an ID
export type Message = BaseMessage & { id: string };

// ----------------------------------------------------------------
// Control messages — used in updates, never stored
// ----------------------------------------------------------------

export class RemoveMessage {
  readonly __type = "RemoveMessage" as const;
  constructor(public readonly id: string) {}
}

export class UpdateMessage {
  readonly __type = "UpdateMessage" as const;
  constructor(
    public readonly id:     string,
    public readonly patch:  Partial<BaseMessage>
  ) {}
}

export type MessageUpdate = BaseMessage | RemoveMessage | UpdateMessage;

// ----------------------------------------------------------------
// ID generator
// ----------------------------------------------------------------

function generateId(): string {
  return `msg-${randomUUID()}`;
}

function ensureId(msg: BaseMessage): Message {
  return { ...msg, id: msg.id ?? generateId() };
}

// ----------------------------------------------------------------
// addMessages reducer
// ----------------------------------------------------------------

/**
 * Smart reducer for message arrays.
 * - Appending new messages: deduplicates by ID
 * - RemoveMessage: removes message with matching ID
 * - UpdateMessage: patches message with matching ID
 */
export function messagesReducer(
  current: Message[],
  update:  MessageUpdate | MessageUpdate[]
): Message[] {
  const updates = Array.isArray(update) ? update : [update];
  let result = [...current];

  for (const u of updates) {
    if (u instanceof RemoveMessage) {
      result = result.filter((m) => m.id !== u.id);
    } else if (u instanceof UpdateMessage) {
      result = result.map((m) =>
        m.id === u.id ? { ...m, ...u.patch, id: m.id } : m
      );
    } else {
      // Regular message — deduplicate by ID
      const msg = ensureId(u as BaseMessage);
      const existingIdx = result.findIndex((m) => m.id === msg.id);
      if (existingIdx >= 0) {
        // Overwrite existing (idempotent re-delivery)
        result[existingIdx] = msg;
      } else {
        result.push(msg);
      }
    }
  }

  return result;
}

// ----------------------------------------------------------------
// Channel factory
// ----------------------------------------------------------------

/**
 * A channel that uses the smart addMessages reducer.
 *
 * @example
 * const graph = new StateGraph<MessagesState>({
 *   channels: {
 *     messages: messagesChannel(),
 *   }
 * });
 */
export function messagesChannel(): Channel<Message[]> {
  return {
    reducer: (current, update) => messagesReducer(current, update as unknown as MessageUpdate[]),
    default: () => [],
  };
}

// ----------------------------------------------------------------
// MessagesState — pre-wired convenience state type
// ----------------------------------------------------------------

export type MessagesState = {
  messages: Message[];
};

export const messagesStateChannels = {
  messages: messagesChannel(),
};

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

export function humanMessage(content: string, id?: string): Message {
  return ensureId({ role: "user", content, id });
}

export function aiMessage(
  content: string,
  opts?: { id?: string; tool_calls?: Message["tool_calls"] }
): Message {
  return ensureId({ role: "assistant", content, id: opts?.id, tool_calls: opts?.tool_calls });
}

export function systemMessage(content: string, id?: string): Message {
  return ensureId({ role: "system", content, id });
}

export function toolMessage(content: string, tool_call_id: string, id?: string): Message {
  return ensureId({ role: "tool", content, tool_call_id, id });
}

export function getMessageById(messages: Message[], id: string): Message | undefined {
  return messages.find((m) => m.id === id);
}

export function filterByRole(messages: Message[], role: Message["role"]): Message[] {
  return messages.filter((m) => m.role === role);
}

/** Trim message history to last N messages (keeps system message at index 0) */
export function trimMessages(messages: Message[], maxMessages: number): Message[] {
  const systemMsgs = messages.filter((m) => m.role === "system");
  const nonSystem  = messages.filter((m) => m.role !== "system");
  let trimmed = nonSystem.slice(-maxMessages);
  // If the slice boundary fell inside an assistant-toolCalls / tool-result pair,
  // the trimmed array may start with orphaned tool messages. Drop them so the
  // history always starts at a clean turn boundary.
  while (trimmed.length > 0 && trimmed[0]!.role === "tool") {
    trimmed = trimmed.slice(1);
  }
  return [...systemMsgs, ...trimmed];
}
