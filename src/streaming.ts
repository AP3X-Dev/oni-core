// ============================================================
// @oni.bot/core — Token Streaming
// ============================================================
// Enables token-level streaming from LLM calls inside nodes.
// Nodes call streamTokens() to register a token emitter.
// The Pregel runner pipes tokens through as "token" stream events.
// ============================================================

import { AsyncLocalStorage } from "node:async_hooks";
import type { ONIStreamEvent, CustomStreamEvent, MessageStreamEvent } from "./types.js";

// ----------------------------------------------------------------
// Token event (extends ONIStreamEvent)
// ----------------------------------------------------------------

export interface TokenStreamEvent {
  event:     "token";
  node:      string;
  token:     string;
  delta:     string;
  timestamp: number;
  agentId?:  string;
}

// ----------------------------------------------------------------
// Token emitter — installed per node, used by streaming LLM calls
// ----------------------------------------------------------------

type TokenHandler = (token: string) => void;

const tokenHandlerALS = new AsyncLocalStorage<TokenHandler>();

/**
 * Scope a token handler to the current async execution context.
 * Parallel nodes each get their own handler — no global state conflicts.
 */
export async function _withTokenHandler<T>(
  handler: TokenHandler,
  fn: () => Promise<T>
): Promise<T> {
  return tokenHandlerALS.run(handler, fn);
}

/**
 * Emit a token from inside a node. Call this for each token
 * received from your streaming LLM SDK.
 *
 * @example
 * addNode("agent", async (state) => {
 *   let fullText = "";
 *   for await (const chunk of llm.stream(messages)) {
 *     emitToken(chunk.delta);
 *     fullText += chunk.delta;
 *   }
 *   return { messages: [aiMessage(fullText)] };
 * });
 */
export function emitToken(token: string): void {
  tokenHandlerALS.getStore()?.(token);
}

// ----------------------------------------------------------------
// StreamWriter — async generator bridge for token streaming
// Lets callers consume tokens as they arrive without blocking
// ----------------------------------------------------------------

export class TokenStreamWriter {
  private queue:    string[] = [];
  private waiters:  Array<(token: string | null) => void> = [];
  private done = false;

  push(token: string): void {
    if (this.waiters.length > 0) {
      this.waiters.shift()!(token);
    } else {
      this.queue.push(token);
    }
  }

  end(): void {
    for (const waiter of this.waiters) waiter(null);
    this.waiters = [];
    this.done = true;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<string> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else if (this.done) {
        return;
      } else {
        const token = await new Promise<string | null>((resolve) => {
          this.waiters.push(resolve);
        });
        if (token === null) {
          // end() was called — flush any tokens that were push()ed
          // between the last queue check and the waiter resolution
          while (this.queue.length > 0) {
            yield this.queue.shift()!;
          }
          return;
        }
        yield token;
      }
    }
  }
}

// ----------------------------------------------------------------
// streamEvents — astream_events equivalent
// Merges graph events + token events into a single stream
// ----------------------------------------------------------------

export type AnyStreamEvent<S> =
  | (ONIStreamEvent<S> & { event: ONIStreamEvent<S>["event"] })
  | TokenStreamEvent
  | CustomStreamEvent
  | MessageStreamEvent;

// ----------------------------------------------------------------
// StreamWriterImpl — node-scoped writer for custom + token events
// ----------------------------------------------------------------

export class StreamWriterImpl {
  private _accumulated = "";

  constructor(
    private readonly onCustom:  (evt: CustomStreamEvent) => void,
    private readonly onToken:   (token: string) => void,
    private readonly onMessage: (evt: MessageStreamEvent) => void,
    private readonly node:      string,
    private readonly step:      number,
    private readonly messageId: string,
    private readonly agentId?:  string,
  ) {}

  emit(name: string, data: unknown): void {
    this.onCustom({
      event:     "custom",
      node:      this.node,
      name,
      data,
      step:      this.step,
      timestamp: Date.now(),
      agentId:   this.agentId,
    });
  }

  token(token: string): void {
    this.onToken(token);
    this._accumulated += token;
    this.onMessage({
      event:     "messages",
      node:      this.node,
      data: {
        chunk:   token,
        content: this._accumulated,
        role:    "assistant",
        id:      this.messageId,
      },
      step:      this.step,
      timestamp: Date.now(),
      agentId:   this.agentId,
    });
  }

  /** Called by Pregel after node completes to emit the complete message */
  _complete(): MessageStreamEvent | null {
    if (this._accumulated.length === 0) return null;
    return {
      event:     "messages/complete",
      node:      this.node,
      data: {
        chunk:   "",
        content: this._accumulated,
        role:    "assistant",
        id:      this.messageId,
      },
      step:      this.step,
      timestamp: Date.now(),
      agentId:   this.agentId,
    };
  }

  get accumulated(): string { return this._accumulated; }
}

// ----------------------------------------------------------------
// BoundedBuffer — backpressure-aware event buffer
// ----------------------------------------------------------------

export type BackpressureStrategy = "drop-oldest" | "error";

export class BoundedBuffer<T> {
  private ring: (T | undefined)[];
  private head = 0;
  private tail = 0;
  private _size = 0;

  constructor(
    private readonly capacity: number,
    private readonly strategy: BackpressureStrategy,
  ) {
    this.ring = new Array(capacity);
  }

  push(item: T): void {
    if (this._size >= this.capacity) {
      if (this.strategy === "drop-oldest") {
        this.ring[this.head] = undefined;
        this.head = (this.head + 1) % this.capacity;
        this._size--;
      } else {
        throw new Error(
          `ONI_STREAM_BACKPRESSURE: Stream buffer full (${this.capacity} items). Consumer is too slow.`
        );
      }
    }
    this.ring[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;
    this._size++;
  }

  drain(): T[] {
    const result: T[] = new Array(this._size);
    for (let i = 0; i < this._size; i++) {
      result[i] = this.ring[(this.head + i) % this.capacity] as T;
    }
    this.ring = new Array(this.capacity);
    this.head = 0;
    this.tail = 0;
    this._size = 0;
    return result;
  }

  get size(): number {
    return this._size;
  }
}
