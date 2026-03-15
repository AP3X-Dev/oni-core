import { A2AClient } from "../client/index.js";
import type { A2AClientConfig } from "../types.js";

export interface A2AAgentDef {
  id: string;
  role: string;
  /** Call this to invoke the remote A2A agent */
  invoke: (message: string) => Promise<string>;
  /** Compatible with ONI ToolDefinition for use in agent loops */
  asTool: () => {
    name: string;
    description: string;
    schema: { type: "object"; properties: { message: { type: "string" } }; required: string[] };
    parallelSafe: boolean;
    execute: (input: { message: string }) => Promise<string>;
  };
  capabilities?: string[];
}

export function a2aAgent(opts: {
  id: string;
  role: string;
  clientConfig: A2AClientConfig;
  capabilities?: string[];
}): A2AAgentDef {
  const client = new A2AClient(opts.clientConfig);
  return {
    id: opts.id,
    role: opts.role,
    capabilities: opts.capabilities,
    invoke: (message) => client.sendTask(message),
    asTool: () => client.asToolDefinition({ name: opts.id, description: opts.role }),
  };
}
