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

const DEFAULT_MAX_BUFFER_SIZE = 1000;

export class PubSub {
  private subscribers = new Map<string, Set<(msg: TopicMessage) => void>>();
  private buffer: TopicMessage[] = [];
  private maxBufferSize: number;

  constructor(opts?: { maxBufferSize?: number }) {
    this.maxBufferSize = opts?.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE;
  }

  /** Publish a message to a topic, notifying all matching subscribers. */
  publish(from: string, topic: string, data: unknown): void {
    const msg: TopicMessage = { topic, data, from, timestamp: Date.now() };
    this.buffer.push(msg);
    // Enforce buffer bounds by dropping oldest entries
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer = this.buffer.slice(this.buffer.length - this.maxBufferSize);
    }
    for (const [pattern, handlers] of this.subscribers) {
      if (topicMatches(pattern, topic)) {
        for (const handler of handlers) {
          try {
            handler(msg);
          } catch {
            // Isolate subscriber errors — delivery continues to remaining handlers
          }
        }
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
 *   `**` may appear anywhere in the pattern — "a.**.b" matches "a.x.b", "a.x.y.b", etc.
 */
export function topicMatches(pattern: string, topic: string): boolean {
  if (pattern === topic) return true;
  if (pattern === "*") return true;
  return matchSegments(pattern.split("."), 0, topic.split("."), 0);
}

function matchSegments(pp: string[], pi: number, tp: string[], ti: number): boolean {
  while (pi < pp.length) {
    const seg = pp[pi]!;
    if (seg === "**") {
      // ** matches zero or more topic segments; try each possible consumption length
      for (let skip = 0; skip <= tp.length - ti; skip++) {
        if (matchSegments(pp, pi + 1, tp, ti + skip)) return true;
      }
      return false;
    }
    if (ti >= tp.length) return false;
    if (seg !== "*" && seg !== tp[ti]) return false;
    pi++;
    ti++;
  }
  return ti === tp.length;
}
