// ============================================================
// @oni.bot/hot-loader — Types
// ============================================================

/**
 * Mirrors the DynamicToolRegistry interface to avoid build-time
 * circular dependency. Only the methods we actually call.
 */
export interface ToolRegistry {
  register(
    name: string,
    handler: ToolHandlerFn,
    opts?: { description?: string; parameters?: Record<string, unknown> }
  ): unknown;
  unregister(name: string): boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolHandlerFn = (args: Record<string, unknown>, state: any) => Promise<ToolResultShape>;

export type ToolResultShape = {
  tool_name: string;
  success: boolean;
  output: string;
  error?: string;
};

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type HotLoaderOptions = {
  /** Absolute path to extensions directory */
  dir: string;
  /** The registry to register into */
  registry: ToolRegistry;
  /** Glob pattern for extension files. Default: "**\/*.{ts,js,mjs}" */
  pattern?: string;
  /** Called after a file's tools are loaded */
  onLoad?: (file: string, tools: string[]) => void;
  /** Called after a file's tools are unloaded */
  onUnload?: (file: string, tools: string[]) => void;
  /** Called when a file fails to load */
  onError?: (file: string, error: Error) => void;
};

export type HotLoader = {
  /** Stops the file watcher */
  stop: () => void;
  /** Returns map of file path -> registered tool names */
  loaded: () => Map<string, string[]>;
};
