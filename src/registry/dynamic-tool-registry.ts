// ============================================================
// @oni.bot/core/registry — DynamicToolRegistry
// ============================================================
// A mutable handler map that sits behind a single compiled
// StateGraph node.  Extensions register/unregister at runtime;
// the graph topology never changes.
// ============================================================

import type { NodeFn } from "../types.js";
import type { ONIMessage } from "../graph.js";
import type { ToolHandler, ToolResult } from "./types.js";

// ----------------------------------------------------------------
// State contract — the node reads pendingTools from state
// ----------------------------------------------------------------

export interface DynamicToolState {
  messages: ONIMessage[];
  pendingTools: Array<{ name: string; args: Record<string, unknown>; id: string }>;
}

// ----------------------------------------------------------------
// Tool metadata for schema generation
// ----------------------------------------------------------------

export interface ToolRegistration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: ToolHandler;
}

// ----------------------------------------------------------------
// DynamicToolRegistry
// ----------------------------------------------------------------

export class DynamicToolRegistry {
  private handlers = new Map<string, ToolRegistration>();

  /**
   * Register a tool handler. If a handler with the same name already exists,
   * it is replaced silently (hot-swap).
   */
  register(
    name: string,
    handler: ToolHandler,
    opts: { description?: string; parameters?: Record<string, unknown> } = {}
  ): this {
    this.handlers.set(name, {
      name,
      description: opts.description ?? "",
      parameters: opts.parameters ?? { type: "object", properties: {} },
      handler,
    });
    return this;
  }

  /** Remove a tool by name. Returns true if it existed. */
  unregister(name: string): boolean {
    return this.handlers.delete(name);
  }

  /** List currently registered tool names. */
  list(): string[] {
    return [...this.handlers.keys()];
  }

  /** Check if a tool is registered. */
  has(name: string): boolean {
    return this.handlers.has(name);
  }

  /**
   * Returns a StateGraph-compatible node function.
   *
   * The node reads `state.pendingTools[0]`, dispatches to the matching
   * handler, and returns the result merged into messages.  If the tool
   * is not found it returns a structured error (never throws).
   */
  asNode(): NodeFn<DynamicToolState> {
    return async (state) => {
      const pending = state.pendingTools?.[0];

      if (!pending) {
        return {};
      }

      const registration = this.handlers.get(pending.name);

      if (!registration) {
        const errorResult: ToolResult = {
          tool_name: pending.name,
          success: false,
          output: "",
          error: `Tool "${pending.name}" is not registered. Available tools: ${this.list().join(", ") || "(none)"}`,
        };

        return {
          messages: [
            {
              role: "tool" as const,
              content: JSON.stringify(errorResult),
              name: pending.name,
              tool_call_id: pending.id,
            },
          ],
        };
      }

      try {
        const result = await registration.handler(pending.args, state);
        return {
          messages: [
            {
              role: "tool" as const,
              content: JSON.stringify(result),
              name: pending.name,
              tool_call_id: pending.id,
            },
          ],
        };
      } catch (err) {
        const errorResult: ToolResult = {
          tool_name: pending.name,
          success: false,
          output: "",
          error: err instanceof Error ? err.message : String(err),
        };

        return {
          messages: [
            {
              role: "tool" as const,
              content: JSON.stringify(errorResult),
              name: pending.name,
              tool_call_id: pending.id,
            },
          ],
        };
      }
    };
  }

  /**
   * Returns a JSON schema array describing all registered tools,
   * suitable for passing to an LLM node as available tool definitions.
   */
  asSchema(): Array<{
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }> {
    return [...this.handlers.values()].map((reg) => ({
      type: "function" as const,
      function: {
        name: reg.name,
        description: reg.description,
        parameters: reg.parameters,
      },
    }));
  }
}
