import type { ToolDefinition, DefineToolOptions, ToolContext } from "./types.js";
import { getConfig, getStore, getCurrentState, getStreamWriter } from "../context.js";
import { validateToolArgs } from "../harness/validate-args.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineTool<TInput = any, TOutput = any>( // SAFE: external boundary — any defaults are needed for generic ToolDefinition compatibility
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
        // Runtime schema validation — TInput erases to `any` in heterogeneous
        // ToolDefinition[], so we validate args against the JSON Schema before
        // passing them to execute(). This mirrors the validation in the harness
        // loop (src/harness/loop/tools.ts) and closes the type-safety gap at
        // this public API boundary.
        if (tool.schema) {
          const validationError = validateToolArgs(call.args, tool.schema, call.name);
          if (validationError) {
            return { toolCallId: call.id, name: call.name, result: validationError, isError: true };
          }
        }
        const result = await executeTool(tool, call.args);
        return { toolCallId: call.id, name: call.name, result };
      } catch (err) {
        return { toolCallId: call.id, name: call.name, result: String(err), isError: true };
      }
    })
  );
}
