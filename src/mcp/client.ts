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
  private _connectLock: Promise<void> | null = null;
  private _refreshLock: Promise<void> | null = null;

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
    // Coalesce concurrent connect calls — wait for the in-flight attempt and
    // share its result rather than each spawning their own transport process.
    if (this._connectLock !== null) {
      return this._connectLock;
    }

    if (this.state === "ready") return;

    this.state = "connecting";
    this.error = undefined;

    // Set the lock synchronously before the first await so no concurrent
    // caller can slip through the guard above.
    const connecting = this._runConnect();
    this._connectLock = connecting;
    try {
      await connecting;
    } finally {
      if (this._connectLock === connecting) {
        this._connectLock = null;
      }
    }
  }

  private async _runConnect(): Promise<void> {
    const transport = new StdioTransport({
      command: this.config.command,
      args: this.config.args,
      env: this.config.env,
      cwd: this.config.cwd,
      onNotification: (n) => this.handleNotification(n),
    });
    this.transport = transport;

    try {
      await transport.start();

      // Abort gracefully if disconnect() was called while suspended.
      // Cast required: TS narrowing can't see external mutation via disconnect().
      if ((this.state as MCPClientState) === "disconnected") return;

      // Initialize handshake
      const initResponse = await transport.send("initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: CLIENT_NAME,
          version: CLIENT_VERSION,
        },
      });

      if ((this.state as MCPClientState) === "disconnected") return;

      if (initResponse.error) {
        throw new Error(
          `MCP initialize failed: ${initResponse.error.message}`,
        );
      }

      const initResult = initResponse.result as MCPInitializeResult;
      this.serverInfo = initResult.serverInfo;

      // Send initialized notification
      transport.notify("notifications/initialized");

      // Discover tools
      await this.refreshTools();

      if ((this.state as MCPClientState) === "disconnected") return;

      this.state = "ready";
    } catch (err) {
      // If disconnect() was called concurrently, it already set state to
      // "disconnected" — don't overwrite that with "error".
      if ((this.state as MCPClientState) === "disconnected") {
        throw err;
      }
      this.state = "error";
      this.error =
        err instanceof Error ? err.message : String(err);
      // Clean up on failure — only if disconnect() hasn't already done so
      if (this.transport === transport) {
        transport.stop();
        this.transport = null;
      }
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
    if (this._refreshLock !== null) {
      return this._refreshLock;
    }

    const refreshing = (async () => {
      if (!this.transport?.isConnected()) {
        throw new Error("MCP client not connected");
      }

      const response = await this.transport.send("tools/list");

      if (response.error) {
        throw new Error(`MCP tools/list failed: ${response.error.message}`);
      }

      const result = response.result as MCPToolListResult | null;
      this.tools = result?.tools ?? [];
    })();

    this._refreshLock = refreshing;
    try {
      await refreshing;
    } finally {
      if (this._refreshLock === refreshing) {
        this._refreshLock = null;
      }
    }
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
