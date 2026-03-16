// ============================================================
// @oni.bot/core/harness/loop — Tools
// Tool schema → adapter conversion + sequential execution.
// ============================================================

import type { LLMToolDef, ONIModelToolCall } from "../../models/types.js";
import type { ToolDefinition } from "../../tools/types.js";
import type {
  LoopToolResult,
  HarnessToolContext,
  LoopMessage,
  AgentLoopConfig,
} from "../types.js";
import { validateToolArgs } from "../validate-args.js";
import { makeMessage } from "./types.js";
import { checkSafety } from "./safety.js";

// ─── buildLLMTools ──────────────────────────────────────────────────────────

/** Convert ToolDefinition[] to LLMToolDef[] for the model adapter. */
export function buildLLMTools(tools: ToolDefinition[]): LLMToolDef[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.schema,
  }));
}

/** Build a name → ToolDefinition lookup map. */
export function buildToolMap(tools: ToolDefinition[]): Map<string, ToolDefinition> {
  const toolMap = new Map<string, ToolDefinition>();
  for (const t of tools) {
    toolMap.set(t.name, t);
  }
  return toolMap;
}

// ─── executeTools ───────────────────────────────────────────────────────────

export interface ToolExecutionContext {
  sessionId: string;
  threadId: string;
  turn: number;
  config: AgentLoopConfig;
  toolMap: Map<string, ToolDefinition>;
  hasMemoryLoader: boolean;
}

/**
 * Execute all tool calls for a turn.
 * Returns tool results and any yield-able events (tool_start, tool_metadata).
 */
export async function executeTools(
  toolCalls: ONIModelToolCall[],
  ctx: ToolExecutionContext,
): Promise<{ toolResults: LoopToolResult[]; events: LoopMessage[] }> {
  const { sessionId, threadId, turn, config, toolMap, hasMemoryLoader } = ctx;
  const toolResults: LoopToolResult[] = [];
  const events: LoopMessage[] = [];

  for (const toolCall of toolCalls) {
    // Fire PreToolUse hook
    if (config.hooksEngine) {
      const preResult = await config.hooksEngine.fire("PreToolUse", {
        sessionId,
        toolName: toolCall.name,
        input: toolCall.args,
      });

      if (preResult?.decision === "deny") {
        toolResults.push({
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: `Tool use denied: ${preResult.reason ?? "blocked by hook"}`,
          isError: true,
        });
        continue;
      }

      // Apply modifiedInput if hook returned one
      if (preResult?.modifiedInput) {
        const stripProtoKeys = (obj: unknown): unknown => {
          if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return obj;
          const clean: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
            if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
            clean[k] = stripProtoKeys(v);
          }
          return clean;
        };
        const sanitized = stripProtoKeys(preResult.modifiedInput) as Record<string, unknown>;
        Object.assign(toolCall.args, sanitized);
      }
    }

    // Safety gate check
    const safetyResult = await checkSafety(config.safetyGate, toolCall.id, toolCall.name, toolCall.args);
    if (safetyResult !== null && !safetyResult.approved) {
      toolResults.push({
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: `Tool blocked by safety gate: ${safetyResult.reason ?? "unsafe operation"}`,
        isError: true,
      });
      continue;
    }

    // Find tool
    const toolDef = toolMap.get(toolCall.name);
    if (!toolDef) {
      toolResults.push({
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: `Unknown tool: ${toolCall.name}`,
        isError: true,
      });
      continue;
    }

    // Validate tool arguments before execution
    if (toolDef.schema) {
      const validationError = validateToolArgs(toolCall.args, toolDef.schema, toolCall.name);
      if (validationError) {
        toolResults.push({
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: `${validationError}. Please retry with correct arguments.`,
          isError: true,
        });
        continue;
      }
    }

    // Yield tool_start so the conductor can emit tool.call events
    events.push(makeMessage("tool_start", sessionId, turn, {
      metadata: {
        toolName: toolCall.name,
        toolArgs: toolCall.args,
        toolCallId: toolCall.id,
      },
    }));

    const metadataUpdates: Array<{ title?: string; metadata?: Record<string, unknown> }> = [];
    const toolCtx: HarnessToolContext = {
      config: {},
      store: null,
      state: {},
      emit: () => {},
      sessionId,
      threadId,
      agentName: config.agentName,
      turn,
      signal: config.signal,
      metadata: (update: { title?: string; metadata?: Record<string, unknown> }) => {
        metadataUpdates.push(update);
      },
    };

    try {
      const startTime = Date.now();
      const rawResult = await toolDef.execute(toolCall.args, toolCtx);
      const durationMs = Date.now() - startTime;
      const content = typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult);

      // Push the successful result first — before the hook — so a hook
      // throw cannot retroactively mark this tool call as failed.
      toolResults.push({
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content,
        durationMs,
      });

      // Yield collected metadata updates from ctx.metadata() calls
      for (const mu of metadataUpdates) {
        events.push(makeMessage("tool_metadata", sessionId, turn, {
          metadata: {
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            title: mu.title,
            data: mu.metadata,
          },
        }));
      }

      // Fire PostToolUse — in its own try/catch so a hook error does not
      // corrupt the conversation history by triggering PostToolUseFailure
      // for a tool that actually succeeded.
      if (config.hooksEngine) {
        try {
          await config.hooksEngine.fire("PostToolUse", {
            sessionId,
            toolName: toolCall.name,
            input: toolCall.args,
            output: rawResult,
            durationMs,
          });
        } catch {
          // Hook errors are non-fatal — the tool result is already recorded.
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      // Fire PostToolUseFailure — in its own try/catch so a hook error does not
      // drop the error result from toolResults or corrupt conversation history.
      if (config.hooksEngine) {
        try {
          await config.hooksEngine.fire("PostToolUseFailure", {
            sessionId,
            toolName: toolCall.name,
            input: toolCall.args,
            error: err instanceof Error ? err : errorMsg,
          });
        } catch {
          // Hook errors are non-fatal — the tool error result is still recorded.
        }
      }

      toolResults.push({
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: hasMemoryLoader
          ? `Tool error: ${errorMsg}\n\nMemory query may help — call memory_query with a specific topic if this failure suggests a knowledge gap.`
          : `Tool error: ${errorMsg}`,
        isError: true,
      });
    }
  }

  return { toolResults, events };
}
