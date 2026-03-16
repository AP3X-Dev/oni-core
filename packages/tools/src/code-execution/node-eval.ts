import { createContext, Script } from "node:vm";
import type { ToolDefinition, ToolContext } from "../types.js";

/**
 * WARNING — SECURITY NOTICE
 *
 * node:vm is NOT a security boundary. The V8 context it creates can be
 * escaped trivially (e.g. `this.constructor.constructor("return process")()`).
 * Do NOT pass untrusted or user-supplied code to this tool unless the host
 * process is itself running inside a hardened sandbox (container, nsjail, etc.).
 *
 * A future version should replace node:vm with a true isolate (isolated-vm,
 * quickjs-emscripten, or similar). See BUG-0023.
 */

interface NodeEvalInput {
  code: string;
  timeout?: number;
}

export function nodeEval(): ToolDefinition {
  return {
    name: "node_eval",
    description:
      "UNSAFE: Execute JavaScript code in the host Node.js process via node:vm " +
      "(NOT a security sandbox — do not pass untrusted input without an external " +
      "process-level sandbox)",
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

      // Build a sandbox with a null prototype so that the
      // `this.constructor.constructor(...)` escape route is cut off.
      const sandbox = Object.create(null) as Record<string, unknown>;
      sandbox.result = undefined;
      sandbox.console = Object.freeze({
        log: (...args: unknown[]) => logs.push(String(args.join(" "))),
        error: (...args: unknown[]) => logs.push(`[error] ${String(args.join(" "))}`),
        warn: (...args: unknown[]) => logs.push(`[warn] ${String(args.join(" "))}`),
      });

      const ctx = createContext(sandbox);
      const script = new Script(`result = (function() { ${i.code} })()`);
      script.runInContext(ctx, { timeout });

      const out = sandbox.result;

      // Freeze the sandbox after reading the result so it cannot be mutated
      // by any lingering references. This is defence-in-depth only — node:vm
      // is NOT a security boundary (see BUG-0023).
      Object.freeze(sandbox);

      return { result: out, logs };
    },
  };
}
