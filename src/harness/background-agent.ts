// ============================================================
// @oni.bot/core/harness — Background Agent
// spawnAgent() wraps agentLoop() in a non-blocking async context
// and returns a handle for monitoring, messaging, and cancellation.
// ============================================================

import type { LoopMessage, AgentLoopConfig } from "./types.js";
import { generateId } from "./types.js";
import { agentLoop } from "./loop/index.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type AgentStatus = "running" | "completed" | "failed" | "cancelled";

export interface AgentHandle {
  readonly id: string;
  readonly status: AgentStatus;
  readonly result: Promise<string>;
  send(message: string): void;
  cancel(): void;
  onEvent(handler: (event: LoopMessage) => void): () => void;
}

export interface SpawnAgentOptions {
  prompt: string;
  config: AgentLoopConfig;
  id?: string;
}

// ─── spawnAgent ─────────────────────────────────────────────────────────────

export function spawnAgent(opts: SpawnAgentOptions): AgentHandle {
  const { prompt, config, id: customId } = opts;
  const id = customId ?? generateId("agent");

  // Mutable status captured by the handle's getter
  let status: AgentStatus = "running";

  // AbortController for cancellation
  const controller = new AbortController();
  config.signal = controller.signal;

  // Message queue for injecting user messages
  const messageQueue: string[] = [];
  config.messageQueue = messageQueue;

  // Event listeners
  const listeners: Set<(event: LoopMessage) => void> = new Set();

  function dispatch(event: LoopMessage): void {
    for (const handler of listeners) {
      try {
        handler(event);
      } catch {
        // Swallow listener errors to avoid breaking the loop
      }
    }
  }

  // Result promise
  let resolveResult: (value: string) => void;
  let rejectResult: (reason: unknown) => void;
  const result = new Promise<string>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  // Self-running async IIFE — not awaited, runs in background
  (async () => {
    let finalContent: string | undefined;

    try {
      for await (const event of agentLoop(prompt, config)) {
        dispatch(event);

        if (event.type === "result") {
          finalContent = event.content ?? "";
        }

        if (event.type === "error" && finalContent === undefined) {
          // If we haven't seen a result yet and we get an error,
          // check if this is an abort or an actual error
          if (controller.signal.aborted) {
            status = "cancelled";
            rejectResult!(new Error("Agent cancelled"));
            return;
          }
        }
      }

      if (finalContent !== undefined) {
        status = "completed";
        resolveResult!(finalContent);
      } else {
        status = "failed";
        rejectResult!(new Error("Agent completed without producing a result"));
      }
    } catch (err) {
      if (controller.signal.aborted) {
        status = "cancelled";
        rejectResult!(new Error("Agent cancelled"));
      } else {
        status = "failed";
        rejectResult!(err);
      }
    }
  })();

  // ─── Handle ─────────────────────────────────────────────────────────────

  const handle: AgentHandle = {
    get id() {
      return id;
    },
    get status() {
      return status;
    },
    get result() {
      return result;
    },
    send(message: string): void {
      messageQueue.push(message);
    },
    cancel(): void {
      controller.abort();
    },
    onEvent(handler: (event: LoopMessage) => void): () => void {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
  };

  return handle;
}
