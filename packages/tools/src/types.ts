// Local ToolDefinition-compatible type for @oni.bot/tools
// Structurally compatible with @oni.bot/core ToolDefinition

export interface JSONSchema {
  type?: string;
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  enum?: unknown[];
  description?: string;
  additionalProperties?: boolean | JSONSchema;
  [key: string]: unknown;
}

export interface ToolContext {
  config: Record<string, unknown>;
  store: unknown;
  state: Record<string, unknown>;
  emit: (event: string, data: unknown) => void;
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  schema: JSONSchema;
  parallelSafe?: boolean;
  execute: (input: TInput, ctx: ToolContext) => Promise<TOutput> | TOutput;
}
