import type { ONIConfig } from "../types.js";
import type { BaseStore } from "../store/index.js";
import type { JSONSchema } from "../models/types.js";

export interface ToolContext {
  config: ONIConfig;
  store: BaseStore | null;
  state: Record<string, unknown>;
  emit: (event: string, data: unknown) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ToolDefinition<TInput = any, TOutput = any> { // SAFE: external boundary — generic tool registry requires any-typed defaults for contravariant compatibility
  name: string;
  description: string;
  schema: JSONSchema;
  /** When false, this tool must not run concurrently with other calls in the same step. Default: true (parallel-safe). */
  parallelSafe?: boolean;
  execute: (input: TInput, ctx: ToolContext) => Promise<TOutput> | TOutput;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface DefineToolOptions<TInput = any, TOutput = any> { // SAFE: external boundary — see ToolDefinition
  name: string;
  description: string;
  schema: JSONSchema;
  /** When true, this tool is safe to execute in parallel with other parallelSafe tools. */
  parallelSafe?: boolean;
  execute: (input: TInput, ctx: ToolContext) => Promise<TOutput> | TOutput;
}

export type ToolPermissions = Record<string, string[] | "*">;
