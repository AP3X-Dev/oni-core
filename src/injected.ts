// ============================================================
// @oni.bot/core — Injected Tool Factory
// ============================================================
// Creates tools that automatically receive state and store
// from the runtime context, hiding these from the tool schema.
// ============================================================

import { getCurrentState, getStore } from "./context.js";
import type { BaseStore } from "./store/index.js";

export interface InjectedToolOptions<S, Args extends Record<string, unknown>> {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments (visible to LLM — no injected params) */
  schema: Record<string, unknown>;
  /** Tool implementation receiving args + injected dependencies */
  fn: (args: Args, injected: { state: S; store: BaseStore | null }) => Promise<unknown> | unknown;
}

export interface InjectedTool<S, Args extends Record<string, unknown>> {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  /** Call the tool — state and store are injected from runtime context */
  fn: (args: Args) => Promise<unknown>;
}

/**
 * Create a tool that automatically receives state and store from the
 * runtime context. The schema only includes the tool's own arguments,
 * not the injected dependencies.
 */
export function createInjectedTool<S, Args extends Record<string, unknown>>(
  opts: InjectedToolOptions<S, Args>,
): InjectedTool<S, Args> {
  return {
    name: opts.name,
    description: opts.description,
    schema: opts.schema,
    fn: async (args: Args) => {
      const state = getCurrentState<S>();
      const store = getStore();
      return opts.fn(args, { state, store });
    },
  };
}
