/**
 * MCP Tool Conversion — converts MCP tool definitions to ONI ToolDefinitions.
 *
 * Bridges MCP protocol tools into the ONI framework so they can be used
 * by the Conductor, subagents, and swarm agents with the same interface
 * as native tools.
 */

import type { ToolDefinition } from "../tools/types.js";
import type { MCPToolDefinition, MCPCallToolResult, MCPContent } from "./types.js";
import type { MCPClient } from "./client.js";

/**
 * Convert a single MCP tool definition into an ONI ToolDefinition.
 *
 * The resulting tool, when executed, forwards the call to the MCP server
 * via the provided client. Results are serialized to a string.
 */
export function mcpToolToDefinition(
  tool: MCPToolDefinition,
  client: MCPClient,
  serverName: string,
): ToolDefinition<Record<string, unknown>, string> {
  return {
    name: `mcp__${serverName}__${tool.name}`,
    description: tool.description ?? `MCP tool: ${tool.name} (via ${serverName})`,
    schema: tool.inputSchema as Record<string, unknown>,
    execute: async (input) => {
      const result = await client.callTool(tool.name, input);
      return formatMCPResult(result);
    },
  };
}

/**
 * Convert all tools from an MCP client into ONI ToolDefinitions.
 */
export function convertMCPTools(
  client: MCPClient,
  serverName: string,
): ToolDefinition[] {
  const tools = client.listTools();
  return tools.map((t) => mcpToolToDefinition(t, client, serverName));
}

/**
 * Format MCP tool result content into a string for the LLM.
 */
export function formatMCPResult(result: MCPCallToolResult): string {
  const parts: string[] = [];

  for (const content of result.content) {
    parts.push(formatContent(content));
  }

  const text = parts.join("\n");

  if (result.isError) {
    return `[MCP Error] ${text}`;
  }

  return text;
}

function formatContent(content: MCPContent): string {
  switch (content.type) {
    case "text":
      return content.text;
    case "image":
      return `[Image: ${content.mimeType ?? "unknown"}, ${content.data?.length ?? 0} bytes base64]`;
    default:
      return "[Unknown content type]";
  }
}
