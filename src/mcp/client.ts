/**
 * MCP Client — connects to an MCP server, discovers tools, and forwards calls.
 *
 * Lifecycle:
 *   1. connect() — spawn server, perform initialize handshake, list tools
 *   2. listTools() — return discovered tools (cached from connect)
 *   3. callTool(name, args) — forward tool invocation to server
 *   4. disconnect() — gracefully shut down
 *
 * Swarm-aware: A single MCPClient instance can serve multiple swarm agents.
 * Tool calls are stateless — concurrent callers are safe.
 */

import { StdioTransport } from "./transport.js";
import type {
  MCPServerConfig,
  MCPToolDefinition,
  MCPCallToolResult,
  MCPClientState,
  MCPClientInfo,
  MCPServerInfo,
  MCPInitializeResult,
  MCPToolListResult,
  JsonRpcNotification,
} from "./types.js";

// ── Constants ─────────────────────────────────────────────────

const MCP_PROTOCOL_VERSION = "2024-11-05";
const CLIENT_NAME = "oni-core";
const CLIENT_VERSION = "1.0.1";

// ── MCPClient ─────────────────────────────────────────────────

export class MCPClient {
  private transport: StdioTransport | null = null;
  private state: MCPClientState = "disconnected";
  private serverInfo: MCPServerInfo | undefined;
  private tools: MCPToolDefinition[] = [];
  private error: string | undefined;
  private onToolsChanged: (() => void) | undefined;

  constructor(
    private config: MCPServerConfig,
    options?: { onToolsChanged?: () => void },
  ) {
    this.onToolsChanged = options?.onToolsChanged;
  }

  // ── Lifecycle ───────────────────────────────────────────────

  /**
   * Connect to the MCP server:
   * 1. Spawn the server process via stdio transport
   * 2. Perform the initialize handshake
   * 3. Send initialized notification
   * 4. Discover available tools
   */
  async connect(): Promise<void> {
    if (this.state === "ready") return;

    this.state = "connecting";
    this.error = undefined;

    try {
      this.transport = new StdioTransport({
        command: this.config.command,
        args: this.config.args,
        env: this.config.env,
        cwd: this.config.cwd,
        onNotification: (n) => this.handleNotification(n),
      });

      await this.transport.start();

      // Initialize handshake
      const initResponse = await this.transport.send("initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: CLIENT_NAME,
          version: CLIENT_VERSION,
        },
      });

      if (initResponse.error) {
        throw new Error(
          `MCP initialize failed: ${initResponse.error.message}`,
        );
      }

      const initResult = initResponse.result as MCPInitializeResult;
      this.serverInfo = initResult.serverInfo;

      // Send initialized notification
      this.transport.notify("notifications/initialized");

      // Discover tools
      await this.refreshTools();

      this.state = "ready";
    } catch (err) {
      this.state = "error";
      this.error =
        err instanceof Error ? err.message : String(err);
      // Clean up on failure
      this.transport?.stop();
      this.transport = null;
      throw err;
    }
  }

  /**
   * Disconnect from the MCP server gracefully.
   */
  async disconnect(): Promise<void> {
    if (this.transport) {
      this.transport.stop();
      this.transport = null;
    }
    this.state = "disconnected";
    this.tools = [];
    this.serverInfo = undefined;
    this.error = undefined;
  }

  // ── Tool Discovery ──────────────────────────────────────────

  /**
   * Refresh the tool list from the server.
   */
  async refreshTools(): Promise<void> {
    if (!this.transport?.isConnected()) {
      throw new Error("MCP client not connected");
    }

    const response = await this.transport.send("tools/list");

    if (response.error) {
      throw new Error(`MCP tools/list failed: ${response.error.message}`);
    }

    const result = response.result as MCPToolListResult;
    this.tools = result.tools ?? [];
  }

  /**
   * Return the cached list of available tools.
   */
  listTools(): MCPToolDefinition[] {
    return [...this.tools];
  }

  // ── Tool Execution ──────────────────────────────────────────

  /**
   * Call a tool on the MCP server.
   * Returns the tool result with content array.
   *
   * Concurrency-safe: multiple callers can invoke simultaneously.
   */
  async callTool(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<MCPCallToolResult> {
    if (!this.transport?.isConnected() || this.state !== "ready") {
      throw new Error("MCP client not ready");
    }

    const response = await this.transport.send("tools/call", {
      name,
      arguments: args ?? {},
    });

    if (response.error) {
      return {
        content: [
          {
            type: "text",
            text: `MCP tool error: ${response.error.message}`,
          },
        ],
        isError: true,
      };
    }

    return response.result as MCPCallToolResult;
  }

  // ── State ───────────────────────────────────────────────────

  getState(): MCPClientState {
    return this.state;
  }

  getInfo(): MCPClientInfo {
    return {
      name: this.config.name,
      state: this.state,
      serverInfo: this.serverInfo,
      tools: [...this.tools],
      error: this.error,
    };
  }

  // ── Notifications ───────────────────────────────────────────

  private handleNotification(notification: JsonRpcNotification): void {
    if (notification.method === "notifications/tools/list_changed") {
      // Server says tools have changed — refresh
      void this.refreshTools().then(() => {
        this.onToolsChanged?.();
      }).catch(() => {
        // Silently ignore refresh failures from notifications
      });
    }
  }
}
