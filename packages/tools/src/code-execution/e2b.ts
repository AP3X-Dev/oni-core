import type { ToolDefinition, ToolContext } from "../types.js";

interface E2BInput {
  code: string;
  language?: "python" | "javascript";
  timeout?: number;
}

interface E2BSandbox {
  runCode: (
    language: string,
    code: string
  ) => Promise<{ stdout: string; stderr: string; exitCode?: number }>;
  close: () => Promise<void>;
}

interface E2BSandboxConstructor {
  create: (opts: { apiKey: string }) => Promise<E2BSandbox>;
}

export function e2bSandbox(config: { apiKey: string }): ToolDefinition {
  return {
    name: "e2b_sandbox",
    description: "Execute code in an E2B cloud sandbox",
    schema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Code to execute" },
        language: {
          type: "string",
          enum: ["python", "javascript"],
          description: "Language to execute (default: python)",
        },
        timeout: {
          type: "number",
          description: "Execution timeout in ms (default 30000)",
        },
      },
      required: ["code"],
      additionalProperties: false,
    },
    parallelSafe: false,
    execute: async (input: unknown, _ctx: ToolContext) => {
      const i = input as E2BInput;
      let SandboxClass: E2BSandboxConstructor;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const e2b = (await import("@e2b/sdk" as any)) as { Sandbox: E2BSandboxConstructor };
        SandboxClass = e2b.Sandbox;
      } catch {
        throw new Error("e2bSandbox requires '@e2b/sdk'. Install it: pnpm add @e2b/sdk");
      }
      const sandbox = await SandboxClass.create({ apiKey: config.apiKey });
      try {
        const result = await sandbox.runCode(i.language ?? "python", i.code);
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode ?? 0,
        };
      } finally {
        await sandbox.close();
      }
    },
  };
}
