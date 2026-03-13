import type { ONIConfig } from "../types.js";
import type { BaseStore } from "../store/index.js";
import type { JSONSchema } from "../models/types.js";

export interface ToolContext {
  config: ONIConfig;
  store: BaseStore | null;
  state: Record<string, unknown>;
  emit: (event: string, data: unknown) => void;
}

export interface ToolDefinition<TInput = any, TOutput = any> {
  name: string;
  description: string;
  schema: JSONSchema;
  execute: (input: TInput, ctx: ToolContext) => Promise<TOutput> | TOutput;
}

export interface DefineToolOptions<TInput = any, TOutput = any> {
  name: string;
  description: string;
  schema: JSONSchema;
  /** When true, this tool is safe to execute in parallel with other parallelSafe tools. */
  parallelSafe?: boolean;
  execute: (input: TInput, ctx: ToolContext) => Promise<TOutput> | TOutput;
}

export type ToolPermissions = Record<string, string[] | "*">;
