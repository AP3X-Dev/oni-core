// ============================================================
// @oni.bot/core — AgentContext Builder
// ============================================================
// Factory that assembles an AgentContext from runtime parts.
// Used by both defineAgent() and agent() factories.
// ============================================================

import type {
  ONIModel,
  ONIModelMessage,
  ChatResponse,
  ChatChunk,
  ToolResult,
  LLMToolDef,
} from "../models/types.js";
import type { ToolDefinition } from "../tools/types.js";
import type { ONIConfig } from "../types.js";
import type { BaseStore } from "../store/index.js";
import type { StreamWriter } from "../context.js";
import type { AgentContext, SwarmMessageView } from "./types.js";

// ----------------------------------------------------------------
// BuildAgentContextOptions — everything needed to construct a ctx
// ----------------------------------------------------------------

export interface BuildAgentContextOptions<S = Record<string, unknown>> {
  model?: ONIModel;
  tools?: ToolDefinition[];
  agentName: string;
  systemPrompt?: string;

  // Runtime values
  config: ONIConfig;
  store: BaseStore | null;
  state: S;
  streamWriter: StreamWriter | null;
  remainingSteps: number;

  // Coordination callbacks
  onSend: (agent: string, payload: unknown) => void;
  getInbox: () => SwarmMessageView[];
  onReply: (msg: SwarmMessageView, payload: unknown) => void;
}

// ----------------------------------------------------------------
// buildAgentContext — assemble a full AgentContext
// ----------------------------------------------------------------

export function buildAgentContext<S = Record<string, unknown>>(
  opts: BuildAgentContextOptions<S>,
): AgentContext<S> {
  const {
    model,
    tools = [],
    agentName,
    systemPrompt,
    config,
    store,
    state,
    streamWriter,
    remainingSteps,
    onSend,
    getInbox,
    onReply,
  } = opts;

  // Convert ToolDefinition[] to LLMToolDef[] for model.chat/stream
  const llmTools: LLMToolDef[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.schema,
  }));

  // Build the ChatParams base (system prompt + tools)
  function makeChatParams(messages: ONIModelMessage[]) {
    return {
      messages,
      tools: llmTools.length > 0 ? llmTools : undefined,
      systemPrompt,
    };
  }

  return {
    // ---- LLM interaction ----

    async chat(messages: ONIModelMessage[]): Promise<ChatResponse> {
      if (!model) {
        throw new Error(
          `Agent "${agentName}" has no model configured. Pass a model via options to use chat().`,
        );
      }
      return model.chat(makeChatParams(messages));
    },

    async *stream(messages: ONIModelMessage[]): AsyncGenerator<ChatChunk> {
      if (!model) {
        throw new Error(
          `Agent "${agentName}" has no model configured. Pass a model via options to use stream().`,
        );
      }
      yield* model.stream(makeChatParams(messages));
    },

    async executeTools(
      calls: Array<{ id: string; name: string; args: Record<string, unknown> }>,
    ): Promise<ToolResult[]> {
      const toolMap = new Map(tools.map((t) => [t.name, t]));

      async function executeOneCall(call: { id: string; name: string; args: Record<string, unknown> }): Promise<ToolResult> {
        const tool = toolMap.get(call.name);
        if (!tool) {
          return {
            toolCallId: call.id,
            name: call.name,
            result: `Tool "${call.name}" not found`,
            isError: true,
          };
        }
        try {
          // Build a manual ToolContext — we don't rely on AsyncLocalStorage here
          // because agent nodes run inside Pregel which provides context, and we
          // want the tool to receive our explicit config/store/state.
          const toolCtx = {
            config,
            store,
            state: state as Record<string, unknown>,
            emit: (event: string, data: unknown) => {
              if (streamWriter) streamWriter.emit(event, data);
            },
          };
          const result = await tool.execute(call.args, toolCtx);
          return { toolCallId: call.id, name: call.name, result };
        } catch (err) {
          return {
            toolCallId: call.id,
            name: call.name,
            result: String(err),
            isError: true,
          };
        }
      }

      // Execute tools — sequentially if any has parallelSafe: false, otherwise in parallel
      const hasSafetyConstraint = calls.some(
        (call) => toolMap.get(call.name)?.parallelSafe === false,
      );

      if (hasSafetyConstraint) {
        const toolResults: ToolResult[] = [];
        for (const call of calls) {
          toolResults.push(await executeOneCall(call));
        }
        return toolResults;
      }

      return Promise.all(calls.map((call) => executeOneCall(call)));
    },

    // ---- Coordination ----

    send: onSend,
    inbox: getInbox,
    reply: onReply,

    // ---- Runtime context ----

    config,
    store,
    state,
    streamWriter,
    remainingSteps,
    agentName,
  };
}
