/**
 * MCP (Model Context Protocol) — client for connecting to external tool servers.
 *
 * Supports stdio transport with Content-Length framing (the standard MCP wire protocol).
 * Discovers tools via tools/list, forwards calls via tools/call, and converts
 * MCP tools into ONI ToolDefinitions for seamless integration.
 *
 * Usage:
 *   import { MCPClient, convertMCPTools } from "@oni.bot/core/mcp";
 *
 *   const client = new MCPClient({ name: "my-server", transport: "stdio", command: "npx", args: ["-y", "my-mcp-server"] });
 *   await client.connect();
 *   const tools = convertMCPTools(client, "my-server");
 *   // tools are now ONI ToolDefinitions — pass to Conductor, swarm, etc.
 */

export { MCPClient } from "./client.js";
export { StdioTransport } from "./transport.js";
export { convertMCPTools, mcpToolToDefinition, formatMCPResult } from "./convert.js";
export type {
  MCPServerConfig,
  MCPToolDefinition,
  MCPCallToolResult,
  MCPClientState,
  MCPClientInfo,
  MCPServerInfo,
  MCPInitializeResult,
  MCPToolListResult,
  MCPContent,
  MCPTextContent,
  MCPImageContent,
  MCPCapabilities,
  MCPToolInputSchema,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  JsonRpcError,
} from "./types.js";
export type { NotificationHandler, StdioTransportConfig } from "./transport.js";
