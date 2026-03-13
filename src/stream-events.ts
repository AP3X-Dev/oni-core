// ============================================================
// @oni.bot/core — astream_events v2 Protocol
// ============================================================
// Wraps stream() output into v2 event protocol with
// on_chain_start/end, run metadata, and tags.
// ============================================================

import type { ONISkeleton, ONIConfig, ONIStreamEvent, StreamMode } from "./types.js";

export interface StreamEvent {
  event: string;
  name?: string;
  data: unknown;
  run_id: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Stream graph execution events using the v2 event protocol.
 * Wraps the debug stream mode into higher-level lifecycle events.
 */
export async function* streamEvents<S>(
  app: ONISkeleton<S>,
  input: Partial<S>,
  config?: ONIConfig,
): AsyncGenerator<StreamEvent> {
  const runId = config?.threadId ?? `run-${Date.now()}`;
  const tags = config?.tags;
  const metadata = config?.metadata;

  const base = { run_id: runId, tags, metadata };

  yield { ...base, event: "on_chain_start", data: { input } };

  let finalData: unknown = undefined;

  for await (const evt of app.stream(input, {
    ...config,
    streamMode: "debug" as StreamMode,
  })) {
    const e = evt as ONIStreamEvent<S>;

    if (e.event === "node_start") {
      yield {
        ...base,
        event: "on_chain_start",
        name: e.node,
        data: {},
      };
    } else if (e.event === "node_end") {
      yield {
        ...base,
        event: "on_chain_end",
        name: e.node,
        data: { output: e.data },
      };
    } else if (e.event === "state_update") {
      finalData = e.data;
    } else if (e.event === "error") {
      yield {
        ...base,
        event: "on_chain_error",
        name: e.node,
        data: { error: e.data },
      };
    }
  }

  yield { ...base, event: "on_chain_end", data: { output: finalData } };
}
