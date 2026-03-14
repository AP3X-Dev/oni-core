// ============================================================
// @oni.bot/core — defineAgent() — Declarative Agent Factory
// ============================================================
// Creates an AgentNode that runs a ReAct loop automatically:
//   1. Seed messages from state.messages
//   2. Loop up to maxSteps:
//      a. Emit llm.request event, call model.chat
//      b. Emit llm.response + audit, record budget usage
//      c. Track token usage; push assistant message
//      d. If no toolCalls -> break (done)
//      e. Execute tools (sequentially if any is parallelSafe: false)
//         - emit tool.call / tool.result events and audit entries
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
    const runCtx = _getRunContext();

    // 1. Seed messages from state
    const existingMessages = (Array.isArray((state as Record<string, unknown>).messages)
      ? (state as Record<string, unknown>).messages
      : []) as ONIModelMessage[];
    const messages: ONIModelMessage[] = [...existingMessages];

    let totalTokens = 0;
    const toolMap = new Map(tools.map((t) => [t.name, t]));

    // Helper: execute a single tool call with events + audit + permission check
    const executeOneCall = async (call: { id: string; name: string; args: Record<string, unknown> }): Promise<ToolResult> => {
      const tool = toolMap.get(call.name);
      if (!tool) {
        return { toolCallId: call.id, name: call.name, result: `Tool "${call.name}" not found`, isError: true };
      }

      // Permission check — outside try/catch so ToolPermissionError propagates as a real failure
      if (runCtx?.toolPermissions) {
        checkToolPermission(runCtx.toolPermissions, name, call.name);
      }

      runCtx?._emitEvent?.({
        type: "tool.call",
        agent: name,
        tool: call.name,
        timestamp: Date.now(),
        input: call.args,
      });

      const toolStart = Date.now();
      try {
        const toolCtx = {
          config: config ?? {},
          store: runCtx?.store ?? null,
          state: state as Record<string, unknown>,
          emit: (event: string, data: unknown) => runCtx?.writer?.emit(event, data),
        };
        const result = await tool.execute(call.args, toolCtx);
        const duration = Date.now() - toolStart;
        runCtx?._emitEvent?.({ type: "tool.result", agent: name, tool: call.name, timestamp: Date.now(), duration, status: "success", output: result });
        runCtx?._auditRecord?.({ timestamp: Date.now(), agent: name, action: "tool.result", data: { tool: call.name, status: "success" } });
        return { toolCallId: call.id, name: call.name, result };
      } catch (err) {
        const duration = Date.now() - toolStart;
        runCtx?._emitEvent?.({ type: "tool.result", agent: name, tool: call.name, timestamp: Date.now(), duration, status: "error", error: String(err) });
        runCtx?._auditRecord?.({ timestamp: Date.now(), agent: name, action: "tool.result", data: { tool: call.name, status: "error", error: String(err) } });
        return { toolCallId: call.id, name: call.name, result: String(err), isError: true };
      }
    };

    // 2. ReAct loop
    for (let step = 0; step < maxSteps; step++) {
      // a. Emit llm.request then call model.chat
      runCtx?._emitEvent?.({
        type: "llm.request",
        agent: name,
        model: model.modelId,
        timestamp: Date.now(),
        messageCount: messages.length,
        hasTools: llmTools.length > 0,
      });
      const llmStart = Date.now();
      const response = await model.chat({
        messages,
        tools: llmTools.length > 0 ? llmTools : undefined,
        systemPrompt,
      });
      const llmDuration = Date.now() - llmStart;

      // b. Emit llm.response + audit + budget
      runCtx?._emitEvent?.({
        type: "llm.response",
        agent: name,
        model: model.modelId,
        timestamp: Date.now(),
        duration: llmDuration,
        usage: response.usage,
        stopReason: response.stopReason,
        hasToolCalls: (response.toolCalls?.length ?? 0) > 0,
      });
      runCtx?._auditRecord?.({
        timestamp: Date.now(),
        agent: name,
        action: "llm.response",
        data: { model: model.modelId, inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens },
      });
      // Record usage — throws BudgetExceededError if over budget
      runCtx?._recordUsage?.(name, model.modelId, response.usage);

      // c. Track token usage
      totalTokens += response.usage.inputTokens + response.usage.outputTokens;

      // d. Push assistant message
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

      // e. If no tool calls -> done
      if (!response.toolCalls || response.toolCalls.length === 0) {
        break;
      }

      // f. Execute tools — sequentially if any has parallelSafe: false, otherwise in parallel
      const hasSafetyConstraint = response.toolCalls.some(
        (call) => toolMap.get(call.name)?.parallelSafe === false,
      );

      let toolResults: ToolResult[];
      if (hasSafetyConstraint) {
        toolResults = [];
        for (const call of response.toolCalls) {
          toolResults.push(await executeOneCall(call as { id: string; name: string; args: Record<string, unknown> }));
        }
      } else {
        toolResults = await Promise.all(
          response.toolCalls.map((call) => executeOneCall(call as { id: string; name: string; args: Record<string, unknown> })),
        );
      }

      // g. Push tool result messages
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
