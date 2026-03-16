import { execFile } from "node:child_process";
import { platform } from "node:os";
import type { ToolDefinition, ToolContext } from "../types.js";

/**
 * BUG-0023: The previous implementation used node:vm which is trivially
 * escapable (e.g. `this.constructor.constructor("return process")()`).
 * node:vm is NOT a security boundary — it only provides a separate V8
 * context, not process-level isolation.
 *
 * This rewrite replaces node:vm with a short-lived subprocess spawned via
 * child_process.execFile. The child receives the code on stdin, executes it
 * in an isolated Node.js process, and returns the result as JSON on stdout.
 * The parent kills the child if it exceeds the configured timeout.
 *
 * BUG-0024: The old implementation called Object.freeze on the sandbox
 * after execution, which could block result write-back when the result
 * contained objects sharing references with the frozen sandbox. The
 * subprocess approach eliminates this entirely — results are serialised
 * across the process boundary via JSON.
 */

interface NodeEvalInput {
  code: string;
  timeout?: number;
}

/**
 * Build the child-process wrapper script as a string.
 *
 * The child reads all of stdin, wraps the user code in an async IIFE that
 * supports `return`, captures console.log / .error / .warn, then writes
 * the result as a single JSON line to stdout.
 */
function buildChildScript(): string {
  // The child script is intentionally a single self-contained program.
  // It does NOT require any external modules beyond Node.js builtins.
  return `
"use strict";

const _logs = [];
const _origConsole = globalThis.console;

globalThis.console = {
  log:   (...a) => _logs.push(a.join(" ")),
  error: (...a) => _logs.push("[error] " + a.join(" ")),
  warn:  (...a) => _logs.push("[warn] " + a.join(" ")),
  info:  (...a) => _logs.push(a.join(" ")),
  debug: (...a) => _logs.push(a.join(" ")),
};

let _input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { _input += chunk; });
process.stdin.on("end", async () => {
  try {
    const _fn = new Function(_input);
    const _result = await _fn();
    process.stdout.write(JSON.stringify({ ok: true, result: _result, logs: _logs }));
  } catch (err) {
    process.stdout.write(JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      logs: _logs,
    }));
  }
});
`;
}

/** Minimal allow-list of environment variables forwarded to the child. */
function safeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const allow = ["PATH", "HOME", "TMPDIR"];
  // On Windows also allow USERPROFILE, TEMP, TMP, SystemRoot, PATHEXT
  if (platform() === "win32") {
    allow.push("USERPROFILE", "TEMP", "TMP", "SystemRoot", "PATHEXT");
  }
  for (const key of allow) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key] as string;
    }
  }
  return env;
}

export function nodeEval(): ToolDefinition {
  return {
    name: "node_eval",
    description:
      "Execute JavaScript code in an isolated Node.js subprocess. " +
      "The code is wrapped in a function body — use `return` to produce a result.",
    schema: {
      type: "object",
      properties: {
        code: { type: "string", description: "JavaScript code to execute" },
        timeout: {
          type: "number",
          description: "Timeout in ms (default 10000, max 30000)",
        },
      },
      required: ["code"],
      additionalProperties: false,
    },
    parallelSafe: false,

    execute: (input: unknown, _ctx: ToolContext): Promise<{ result: unknown; logs: string[] }> => {
      const i = input as NodeEvalInput;
      const timeout = Math.min(i.timeout ?? 10_000, 30_000);

      return new Promise((resolve, reject) => {
        const child = execFile(
          process.execPath, // node binary
          ["--no-warnings", "-e", buildChildScript()],
          {
            timeout,
            env: safeEnv(),
            maxBuffer: 10 * 1024 * 1024, // 10 MiB
            windowsHide: true,
          },
          (error, stdout, _stderr) => {
            if (error) {
              // Timeout-killed processes get error.killed === true
              if (error.killed) {
                return reject(
                  new Error(`node_eval: execution timed out after ${timeout}ms`),
                );
              }
              // If we got partial stdout the child may have written an error
              // response before crashing — try to parse it.
              if (stdout) {
                try {
                  const parsed = JSON.parse(stdout) as {
                    ok: boolean;
                    error?: string;
                    logs: string[];
                  };
                  if (!parsed.ok && parsed.error) {
                    return reject(new Error(parsed.error));
                  }
                } catch {
                  // stdout wasn't valid JSON — fall through
                }
              }
              return reject(error);
            }

            // Successful exit — parse the JSON payload.
            try {
              const parsed = JSON.parse(stdout) as {
                ok: boolean;
                result?: unknown;
                error?: string;
                logs: string[];
              };
              if (parsed.ok) {
                return resolve({ result: parsed.result, logs: parsed.logs });
              }
              return reject(new Error(parsed.error ?? "Unknown execution error"));
            } catch {
              return reject(
                new Error("node_eval: failed to parse child output"),
              );
            }
          },
        );

        // Pipe the user code into stdin and close it.
        child.stdin?.end(i.code);
      });
    },
  };
}
