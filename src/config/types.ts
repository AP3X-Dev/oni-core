// ============================================================
// @oni.bot/core/config — Types
// ============================================================

/** Model provider + model ID pair. */
export interface ModelConfig {
  provider: string;
  model: string;
}

/** Named agent definition (data-driven, composable into swarm slots). */
export interface AgentConfig {
  /** Override model for this agent */
  model?: ModelConfig;
  /** Tool names this agent can use (empty = all) */
  tools?: string[];
  /** Maximum turns for this agent's loop */
  maxSteps?: number;
  /** System prompt override or extension */
  prompt?: string;
  /** Per-agent permission overrides */
  permissions?: PermissionRuleset;
}

/** Permission rules in config format (tool → action or tool → pattern map). */
export type PermissionRuleset = Record<
  string,
  "allow" | "deny" | "ask" | Record<string, "allow" | "deny" | "ask">
>;

/** Compaction behavior config. */
export interface CompactionConfig {
  /** Enable auto-compaction on context overflow (default: true) */
  auto?: boolean;
  /** Usage fraction threshold (default: 0.68) */
  threshold?: number;
  /** Additional tool names whose output survives pruning */
  protectedTools?: string[];
}

/** Swarm default settings. */
export interface SwarmConfig {
  /** Default topology when auto-select isn't used */
  defaultTopology?: string;
  /** Max concurrent agents in pool/fan-out topologies */
  maxConcurrency?: number;
  /** Per-agent timeout in ms */
  agentTimeout?: number;
  /** Default pool size */
  poolSize?: number;
}

/** LSP server configuration. */
export interface LSPServerConfig {
  command: string;
  args?: string[];
  /** File extensions this server handles */
  extensions?: string[];
}

/** Root configuration object — loaded from JSONC files. */
export interface ONIConfig {
  /** Default model for all agents */
  model?: ModelConfig;
  /** Named agent definitions */
  agents?: Record<string, AgentConfig>;
  /** Permission rules */
  permissions?: PermissionRuleset;
  /** Compaction settings */
  compaction?: CompactionConfig;
  /** Swarm defaults */
  swarm?: SwarmConfig;
  /** LSP server config. Set to false to disable all LSP. */
  lsp?: Record<string, LSPServerConfig> | false;
}

/** Options for loadConfig(). */
export interface LoadConfigOptions {
  /** Override global config directory (default: ~/.oni) */
  globalDir?: string;
  /** Project directory to look for config files (default: process.cwd()) */
  projectDir?: string;
  /** Inline config to merge last (highest priority) */
  inline?: Partial<ONIConfig>;
}
