// ============================================================
// @oni.bot/core — defineAgent() — Declarative Agent Factory
// ============================================================
// Creates an AgentNode that runs a ReAct loop automatically:
//   1. Seed messages from state.messages
//   2. Loop up to maxSteps:
//      a. Call model.chat with messages + systemPrompt + tools
//      b. Track token usage, break if maxTokens exceeded
//      c. Push assistant message
//      d. If no toolCalls -> break (done)
//      e. Execute tools with manual ToolContext
//      f. Push tool result messages
//   3. Return { messages }
// ============================================================

import type { ONIModelMessage, LLMToolDef, ToolResult } from "../models/types.js";
import type { ONIConfig } from "../types.js";
import type { DefineAgentOptions, AgentNode } from "./types.js";
import { _getRunContext } from "../context.js";
import { checkToolPermission } from "../guardrails/permissions.js";

/**
 * defineAgent — create a declarative ReAct agent
 *
 * The returned AgentNode._nodeFn is suitable for use as a graph node.
 * It expects the state to have an optional `messages` field (ONIModelMessage[])
 * and returns `{ messages }` with the conversation appended.
 */
export function defineAgent<S extends Record<string, unknown> = Record<string, unknown>>(
  opts: DefineAgentOptions,
): AgentNode<S> {
  const {
    name,
    description,
    model,
    tools = [],
    systemPrompt,
    maxSteps = 10,
    maxTokens,
  } = opts;

  // Pre-compute LLMToolDef[] from ToolDefinition[]
  const llmTools: LLMToolDef[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.schema,
  }));

  const _nodeFn = async (state: S, config?: ONIConfig): Promise<Partial<S>> => {
    // 1. Seed messages from state
    const existingMessages = (Array.isArray((state as Record<string, unknown>).messages)
      ? (state as Record<string, unknown>).messages
      : []) as ONIModelMessage[];
    const messages: ONIModelMessage[] = [...existingMessages];

    let totalTokens = 0;

    // 2. ReAct loop
    for (let step = 0; step < maxSteps; step++) {
      // a. Call model.chat
      const response = await model.chat({
        messages,
        tools: llmTools.length > 0 ? llmTools : undefined,
        systemPrompt,
      });

      // b. Track token usage
      totalTokens += response.usage.inputTokens + response.usage.outputTokens;

      // c. Push assistant message
      const assistantMsg: ONIModelMessage = {
        role: "assistant",
        content: response.content,
      };
      if (response.toolCalls && response.toolCalls.length > 0) {
        assistantMsg.toolCalls = response.toolCalls;
      }
      messages.push(assistantMsg);

      // Check maxTokens budget
      if (maxTokens !== undefined && totalTokens >= maxTokens) {
        break;
      }

      // d. If no tool calls -> done
      if (!response.toolCalls || response.toolCalls.length === 0) {
        break;
      }

      // e. Execute tools with manual ToolContext
      const toolMap = new Map(tools.map((t) => [t.name, t]));
      const toolResults: ToolResult[] = await Promise.all(
        response.toolCalls.map(async (call) => {
          const tool = toolMap.get(call.name);
          if (!tool) {
            return {
              toolCallId: call.id,
              name: call.name,
              result: `Tool "${call.name}" not found`,
              isError: true,
            };
          }
          // Check tool permissions before execution — must be outside try/catch
          // so ToolPermissionError propagates as a real failure, not an isError result
          const runCtx = _getRunContext();
          if (runCtx?.toolPermissions) {
            checkToolPermission(runCtx.toolPermissions, name, call.name);
          }
          try {
            const toolCtx = {
              config: config ?? {},
              store: null,
              state: state as Record<string, unknown>,
              emit: () => {},
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
        }),
      );

      // f. Push tool result messages
      for (const tr of toolResults) {
        messages.push({
          role: "tool",
          content: typeof tr.result === "string" ? tr.result : JSON.stringify(tr.result),
          toolCallId: tr.toolCallId,
          name: tr.name,
        });
      }
    }

    // 3. Return updated messages (only the new ones appended during this run)
    const newMessages = messages.slice(existingMessages.length);
    return { messages: newMessages } as unknown as Partial<S>;
  };

  return {
    name,
    description,
    model,
    tools,
    systemPrompt,
    maxSteps,
    maxTokens,
    _nodeFn,
    _isAgent: true,
  };
}
