import { createContext, Script } from "node:vm";
import type { ToolDefinition, ToolContext } from "../types.js";

interface NodeEvalInput {
  code: string;
  timeout?: number;
}

export function nodeEval(): ToolDefinition {
  return {
    name: "node_eval",
    description: "Execute JavaScript code in a sandboxed Node.js context",
    schema: {
      type: "object",
      properties: {
        code: { type: "string", description: "JavaScript code to execute" },
        timeout: { type: "number", description: "Timeout in ms (default 5000, max 30000)" },
      },
      required: ["code"],
      additionalProperties: false,
    },
    parallelSafe: false,
    execute: (input: unknown, _ctx: ToolContext) => {
      const i = input as NodeEvalInput;
      const timeout = Math.min(i.timeout ?? 5000, 30000);
      const logs: string[] = [];
      const sandbox = {
        result: undefined as unknown,
        console: {
          log: (...args: unknown[]) => logs.push(String(args.join(" "))),
          error: (...args: unknown[]) => logs.push(`[error] ${String(args.join(" "))}`),
          warn: (...args: unknown[]) => logs.push(`[warn] ${String(args.join(" "))}`),
        },
      };
      const ctx = createContext(sandbox);
      const script = new Script(`result = (function() { ${i.code} })()`);
      script.runInContext(ctx, { timeout });
      return { result: sandbox.result, logs };
    },
  };
}
