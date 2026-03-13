/**
 * @oni.bot/core — Pub/Sub coordination
 *
 * Provides topic-based publish/subscribe messaging between agents.
 * Supports wildcard patterns ("*" for single segment, "**" for deep match).
 */

export interface TopicMessage {
  topic: string;
  data: unknown;
  from: string;
  timestamp: number;
}

export class PubSub {
  private subscribers = new Map<string, Set<(msg: TopicMessage) => void>>();
  private buffer: TopicMessage[] = [];
  private maxBufferSize: number | undefined;

  constructor(opts?: { maxBufferSize?: number }) {
    this.maxBufferSize = opts?.maxBufferSize;
  }

  /** Publish a message to a topic, notifying all matching subscribers. */
  publish(from: string, topic: string, data: unknown): void {
    const msg: TopicMessage = { topic, data, from, timestamp: Date.now() };
    this.buffer.push(msg);
    // Enforce buffer bounds by dropping oldest
    if (this.maxBufferSize != null && this.buffer.length > this.maxBufferSize) {
      this.buffer = this.buffer.slice(this.buffer.length - this.maxBufferSize);
    }
    for (const [pattern, handlers] of this.subscribers) {
      if (topicMatches(pattern, topic)) {
        for (const handler of handlers) handler(msg);
      }
    }
  }

  /**
   * Subscribe to a topic pattern. Returns an unsubscribe function.
   * Patterns support "*" (single segment) and "**" (deep match).
   */
  subscribe(
    pattern: string,
    handler: (msg: TopicMessage) => void,
  ): () => void {
    if (!this.subscribers.has(pattern))
      this.subscribers.set(pattern, new Set());
    this.subscribers.get(pattern)!.add(handler);
    return () => {
      this.subscribers.get(pattern)?.delete(handler);
    };
  }

  /** Return all buffered messages matching the given topic pattern. */
  getMessages(pattern: string): TopicMessage[] {
    return this.buffer.filter((m) => topicMatches(pattern, m.topic));
  }

  /** Drain the buffer, returning all buffered messages. */
  flush(): TopicMessage[] {
    const msgs = [...this.buffer];
    this.buffer = [];
    return msgs;
  }
}

/**
 * Check whether a topic pattern matches a concrete topic string.
 *
 * Rules:
 * - Exact match: "a.b" matches "a.b"
 * - Global wildcard: "*" matches any topic
 * - Single-segment wildcard: "a.*" matches "a.b" but not "a.b.c"
 * - Deep wildcard: "a.**" matches "a.b", "a.b.c", "a.b.c.d", etc.
 */
export function topicMatches(pattern: string, topic: string): boolean {
  if (pattern === topic) return true;
  if (pattern === "*") return true;

  const pp = pattern.split(".");
  const tp = topic.split(".");

  for (let i = 0; i < pp.length; i++) {
    if (pp[i] === "**") return true;
    if (pp[i] === "*") {
      if (i === pp.length - 1) return tp.length === pp.length;
      continue;
    }
    if (pp[i] !== tp[i]) return false;
  }

  return pp.length === tp.length;
}
