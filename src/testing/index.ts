// ============================================================
// @oni.bot/core/testing — Test Utilities
// ============================================================

import type { ONIModel, ChatParams, ChatResponse, ChatChunk } from "../models/index.js";
import type { StateGraph } from "../graph.js";
import type { ONIStreamEvent, CustomStreamEvent, MessageStreamEvent, StreamMode } from "../types.js";
import { MemoryCheckpointer } from "../checkpoint.js";
import { randomUUID } from "node:crypto";
import { InMemoryStore } from "../store/index.js";

// ----------------------------------------------------------------
// Mock Model
// ----------------------------------------------------------------

interface MockResponse {
  role: "assistant";
  content: string;
  toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
}

interface MockModelInstance extends ONIModel {
  callHistory: ChatParams[];
  reset(): void;
}

export function mockModel(responses: MockResponse[]): MockModelInstance {
  let index = 0;
  const history: ChatParams[] = [];

  return {
    provider: "mock",
    modelId: "mock-model",
    capabilities: { streaming: true, tools: true, vision: false, embeddings: false },
    callHistory: history,

    async chat(params: ChatParams): Promise<ChatResponse> {
      history.push(params);
      const resp = responses[index % Math.max(responses.length, 1)];
      index++;
      if (!resp) {
        return {
          content: "",
          usage: { inputTokens: 0, outputTokens: 0 },
          stopReason: "end",
        };
      }
      return {
        content: resp.content,
        toolCalls: resp.toolCalls,
        usage: { inputTokens: 10, outputTokens: resp.content.length },
        stopReason: resp.toolCalls ? "tool_use" : "end",
      };
    },

    async *stream(params: ChatParams): AsyncGenerator<ChatChunk> {
      history.push(params);
      const resp = responses[index % Math.max(responses.length, 1)];
      index++;
      if (!resp) return;
      for (const char of resp.content) {
        yield { type: "text", text: char };
      }
      yield { type: "usage", usage: { inputTokens: 10, outputTokens: resp.content.length } };
    },

    reset() {
      index = 0;
      history.length = 0;
    },
  };
}

// ----------------------------------------------------------------
// Graph Assertions
// ----------------------------------------------------------------

interface GraphAssertions {
  hasNode?: string[];
  nodeCount?: number;
  hasEdge?: [string, string][];
}

export function assertGraph<S extends Record<string, unknown>>(
  graph: StateGraph<S>,
  assertions: GraphAssertions,
): void {
  const nodes = graph.getNodeMap();
  const edges = graph.getEdges() as Array<{ type: string; from: string; to?: string }>;

  if (assertions.hasNode) {
    for (const name of assertions.hasNode) {
      if (!nodes.has(name)) {
        throw new Error(
          `assertGraph: expected node "${name}" to exist. Existing: [${[...nodes.keys()].join(", ")}]`,
        );
      }
    }
  }

  if (assertions.nodeCount != null && nodes.size !== assertions.nodeCount) {
    throw new Error(`assertGraph: expected ${assertions.nodeCount} nodes, found ${nodes.size}`);
  }

  if (assertions.hasEdge) {
    for (const [from, to] of assertions.hasEdge) {
      const found = edges.some((e) => e.type === "static" && e.from === from && e.to === to);
      if (!found) {
        throw new Error(`assertGraph: expected edge "${from}" -> "${to}" not found`);
      }
    }
  }
}

// ----------------------------------------------------------------
// Test Harness
// ----------------------------------------------------------------

interface TestHarness<S extends Record<string, unknown>> {
  invoke(input: Partial<S>, config?: Record<string, unknown>): Promise<S>;
  collectStream(input: Partial<S>, streamMode?: StreamMode): Promise<(ONIStreamEvent<S> | CustomStreamEvent | MessageStreamEvent)[]>;
}

export function createTestHarness<S extends Record<string, unknown>>(
  graph: StateGraph<S>,
  options?: { checkpointer?: import("../types.js").ONICheckpointer<S>; store?: import("../store/index.js").BaseStore },
): TestHarness<S> {
  const app = graph.compile({
    checkpointer: options?.checkpointer ?? new MemoryCheckpointer(),
    store: options?.store ?? new InMemoryStore(),
  });

  return {
    async invoke(input, config) {
      return app.invoke(input, { threadId: `test-${randomUUID()}`, ...config });
    },
    async collectStream(input, streamMode = "updates") {
      const events: (ONIStreamEvent<S> | CustomStreamEvent | MessageStreamEvent)[] = [];
      for await (const evt of app.stream(input, {
        threadId: `test-stream-${randomUUID()}`,
        streamMode,
      })) {
        events.push(evt);
      }
      return events;
    },
  };
}

// Re-export types for consumers
export type { MockResponse, MockModelInstance, GraphAssertions, TestHarness };
