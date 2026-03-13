/**
 * MCP (Model Context Protocol) Types — zero-dependency type definitions.
 *
 * Covers:
 * - JSON-RPC 2.0 message framing
 * - MCP protocol types (initialize, tools/list, tools/call)
 * - Server configuration
 * - Tool type conversion helpers
 */

// ── JSON-RPC 2.0 ─────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ── MCP Protocol Types ───────────────────────────────────────

export interface MCPServerConfig {
  /** Display name for the server */
  name: string;
  /** Transport: "stdio" is the primary supported transport */
  transport: "stdio";
  /** Command to spawn the server process */
  command: string;
  /** Command arguments */
  args?: string[];
  /** Environment variables for the server process */
  env?: Record<string, string>;
  /** Working directory for the server process */
  cwd?: string;
}

export interface MCPCapabilities {
  tools?: Record<string, never>;
  resources?: Record<string, never>;
  prompts?: Record<string, never>;
}

export interface MCPServerInfo {
  name: string;
  version: string;
}

export interface MCPInitializeResult {
  protocolVersion: string;
  capabilities: MCPCapabilities;
  serverInfo: MCPServerInfo;
}

export interface MCPToolInputSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface MCPToolDefinition {
  name: string;
  description?: string;
  inputSchema: MCPToolInputSchema;
}

export interface MCPToolListResult {
  tools: MCPToolDefinition[];
}

export interface MCPTextContent {
  type: "text";
  text: string;
}

export interface MCPImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export type MCPContent = MCPTextContent | MCPImageContent;

export interface MCPCallToolResult {
  content: MCPContent[];
  isError?: boolean;
}

// ── MCP Client State ─────────────────────────────────────────

export type MCPClientState =
  | "disconnected"
  | "connecting"
  | "ready"
  | "error";

export interface MCPClientInfo {
  name: string;
  state: MCPClientState;
  serverInfo?: MCPServerInfo;
  tools: MCPToolDefinition[];
  error?: string;
}
