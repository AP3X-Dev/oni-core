// ============================================================
// @oni.bot/core/registry — Types
// ============================================================

export type ToolHandler = (
  args: Record<string, unknown>,
  state: unknown // State shape varies by graph; callers narrow via DynamicToolState.
) => Promise<ToolResult>;

export type ToolResult = {
  tool_name: string;
  success: boolean;
  output: string;
  error?: string;
};
