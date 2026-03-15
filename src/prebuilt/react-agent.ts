// ============================================================
// @oni.bot/core/prebuilt — createReactAgent
// ============================================================
// Factory that wires up a complete ReAct agent skeleton:
//   START → agent ←→ tools → END
//
// Usage:
//   const app = createReactAgent({ llm, tools });
//   const result = await app.invoke({ messages: [userMsg] });
// ============================================================

import { StateGraph } from "../graph.js";
import { START, END } from "../types.js";
import type { ONIMessage, MessageState } from "../graph.js";
import type { ONIConfig, ONISkeleton, RetryPolicy } from "../types.js";
import type { ONICheckpointer } from "../types.js";
import { appendList } from "../types.js";
import { createToolNode, toolsCondition, type ONITool } from "./tool-node.js";
import type { ONIModel } from "../models/types.js";

// ----------------------------------------------------------------
// LLM interface — bring your own (Anthropic, OpenAI, Ollama, etc.)
// Accepts either ONIModel (preferred) or the legacy ONILanguageModel.
// ----------------------------------------------------------------

export interface ONILanguageModel {
  invoke(
    messages: ONIMessage[],
    config?:  { tools?: LLMToolSchema[]; signal?: AbortSignal }
  ): Promise<ONIMessage>;
}

export interface LLMToolSchema {
  name:        string;
  description: string;
  parameters:  Record<string, unknown>; // JSON Schema
}

/** Detect if value is an ONIModel (has chat method, no invoke method) */
function isONIModel(obj: unknown): obj is ONIModel {
  return (
    typeof obj === "object" &&
    obj !== null &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (obj as any).chat === "function" && // SAFE: external boundary — duck-typing unknown input to detect ONIModel shape
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (obj as any).provider === "string" // SAFE: external boundary — duck-typing unknown input to detect ONIModel shape
  );
}

/** Adapt ONIModel to the ONILanguageModel interface used by createReactAgent */
function adaptModel(model: ONIModel): ONILanguageModel {
  return {
    async invoke(messages, config) {
      const response = await model.chat({
        messages: messages.map((m) => ({
          role: m.role as "user" | "assistant" | "system" | "tool",
          content: m.content,
          toolCalls: m.tool_calls?.map((tc) => ({
            id: tc.id,
            name: tc.name,
            args: tc.args,
          })),
          toolCallId: m.tool_call_id,
        })),
        tools: config?.tools?.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
        signal: config?.signal,
      });
      const msg: ONIMessage = {
        role: "assistant",
        content: response.content,
      };
      if (response.toolCalls?.length) {
        msg.tool_calls = response.toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          args: tc.args,
        }));
      }
      return msg;
    },
  };
}

// ----------------------------------------------------------------
// createReactAgent options
// ----------------------------------------------------------------

export interface CreateReactAgentOptions {
  /** The LLM to use as the agent brain (ONIModel or legacy ONILanguageModel) */
  llm:              ONIModel | ONILanguageModel;
  /** Tools the agent can call */
  tools?:           ONITool[];
  /** System prompt prepended to every invocation */
  systemPrompt?:    string;
  /** Retry policy for the agent node */
  agentRetry?:      RetryPolicy;
  /** Retry policy for the tool node */
  toolRetry?:       RetryPolicy;
  /** Interrupt before/after specific nodes */
  interruptBefore?: string[];
  interruptAfter?:  string[];
  /** Checkpointer for persistence */
  checkpointer?:    ONICheckpointer<MessageState>;
}

// ----------------------------------------------------------------
// Factory
// ----------------------------------------------------------------

export function createReactAgent(
  opts: CreateReactAgentOptions
): ONISkeleton<MessageState> {
  const {
    llm: rawLlm,
    tools           = [],
    systemPrompt,
    agentRetry,
    toolRetry,
    interruptBefore,
    interruptAfter,
    checkpointer,
  } = opts;

  // Auto-adapt ONIModel to the internal ONILanguageModel interface
  const llm: ONILanguageModel = isONIModel(rawLlm) ? adaptModel(rawLlm) : rawLlm;

  const graph = new StateGraph<MessageState>({
    channels: { messages: appendList<ONIMessage>(() => []) },
  });

  // Build LLM tool schemas for the model
  const llmToolSchemas: LLMToolSchema[] = tools.map((t) => ({
    name:        t.name,
    description: t.description,
    parameters:  t.schema ?? { type: "object", properties: {} },
  }));

  // ---- Agent node ----
  graph.addNode(
    "agent",
    async (state: MessageState, config?: ONIConfig) => {
      const messages: ONIMessage[] = systemPrompt
        ? [{ role: "system", content: systemPrompt }, ...state.messages]
        : state.messages;

      const response = await llm.invoke(messages, {
        tools: llmToolSchemas.length > 0 ? llmToolSchemas : undefined,
        signal: config?.signal,
      });

      return { messages: [response] };
    },
    { retry: agentRetry }
  );

  // ---- Tool node (only if tools provided) ----
  if (tools.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    graph.addNode("tools", createToolNode(tools) as any, { // SAFE: external boundary — createToolNode returns NodeFn<ToolState> which is compatible with ReactAgentState
      retry: toolRetry,
    });

    graph.addEdge(START, "agent");
    graph.addConditionalEdges("agent", toolsCondition);
    graph.addEdge("tools", "agent");
  } else {
    // No tools — agent always goes to END
    graph.addEdge(START, "agent");
    graph.addEdge("agent", END);
  }

  return graph.compile({ checkpointer, interruptBefore, interruptAfter });
}

// Re-export for convenience
export type { NodeFn } from "../types.js";
