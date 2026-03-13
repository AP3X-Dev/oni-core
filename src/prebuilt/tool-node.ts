// ============================================================
// @oni.bot/core/prebuilt — ToolNode
// ============================================================
// Drop-in node that executes tool calls found in the last
// assistant message and appends the results as tool messages.
// Compatible with OpenAI / Anthropic tool_call schemas.
// ============================================================

import type { NodeFn } from "../types.js";
import type { ONIMessage, ONIToolCall } from "../graph.js";

// ----------------------------------------------------------------
// Tool definition
// ----------------------------------------------------------------

export interface ONITool {
  name:        string;
  description: string;
  schema?:     Record<string, unknown>; // JSON Schema for args
  fn:          (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

// ----------------------------------------------------------------
// ToolNode factory
// ----------------------------------------------------------------

export function createToolNode(
  tools: ONITool[]
): NodeFn<{ messages: ONIMessage[] }> {
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  return async (state) => {
    const lastMsg = state.messages.at(-1);

    if (!lastMsg || lastMsg.role !== "assistant" || !lastMsg.tool_calls?.length) {
      return {};
    }

    const results = await Promise.all(
      lastMsg.tool_calls.map(async (tc: ONIToolCall) => {
        const tool = toolMap.get(tc.name);

        if (!tool) {
          return {
            role:          "tool" as const,
            content:       `Error: Tool "${tc.name}" not found.`,
            name:          tc.name,
            tool_call_id:  tc.id,
          };
        }

        try {
          const output = await tool.fn(tc.args);
          return {
            role:          "tool" as const,
            content:       typeof output === "string" ? output : JSON.stringify(output),
            name:          tc.name,
            tool_call_id:  tc.id,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            role:          "tool" as const,
            content:       `Error running tool "${tc.name}": ${msg}`,
            name:          tc.name,
            tool_call_id:  tc.id,
          };
        }
      })
    );

    return { messages: results };
  };
}

// ----------------------------------------------------------------
// toolsCondition — standard router: tools → agent if tool_calls,
//                  tools → END if final answer
// ----------------------------------------------------------------

export function toolsCondition(
  state: { messages: ONIMessage[] }
): "tools" | "__end__" {
  const last = state.messages.at(-1);
  if (last?.role === "assistant" && last.tool_calls?.length) return "tools";
  return "__end__";
}
