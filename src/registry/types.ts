// ============================================================
// @oni.bot/core/registry — Types
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolHandler = (
  args: Record<string, unknown>,
  state: any // SAFE: state shape varies by graph — callers narrow via DynamicToolState
) => Promise<ToolResult>;

export type ToolResult = {
  tool_name: string;
  success: boolean;
  output: string;
  error?: string;
};
