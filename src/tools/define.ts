import type { ToolDefinition, DefineToolOptions, ToolContext } from "./types.js";
import { getConfig, getStore, getCurrentState, getStreamWriter } from "../context.js";

export function defineTool<TInput = any, TOutput = any>(
  opts: DefineToolOptions<TInput, TOutput>
): ToolDefinition<TInput, TOutput> {
  return {
    name: opts.name,
    description: opts.description,
    schema: opts.schema,
    parallelSafe: opts.parallelSafe,
    execute: opts.execute,
  };
}

export async function executeTool<TInput, TOutput>(
  tool: ToolDefinition<TInput, TOutput>,
  input: TInput
): Promise<TOutput> {
  const ctx: ToolContext = {
    config: getConfig(),
    store: getStore(),
    state: getCurrentState<Record<string, unknown>>(),
    emit: (event, data) => {
      const writer = getStreamWriter();
      if (writer) writer.emit(event, data);
    },
  };
  return await tool.execute(input, ctx);
}

export async function executeToolCalls(
  tools: ToolDefinition[],
  calls: Array<{ name: string; args: Record<string, unknown>; id: string }>
): Promise<Array<{ toolCallId: string; name: string; result: unknown; isError?: boolean }>> {
  const toolMap = new Map(tools.map(t => [t.name, t]));
  return Promise.all(
    calls.map(async (call) => {
      const tool = toolMap.get(call.name);
      if (!tool) {
        return { toolCallId: call.id, name: call.name, result: `Tool "${call.name}" not found`, isError: true };
      }
      try {
        const result = await executeTool(tool, call.args);
        return { toolCallId: call.id, name: call.name, result };
      } catch (err) {
        return { toolCallId: call.id, name: call.name, result: String(err), isError: true };
      }
    })
  );
}
