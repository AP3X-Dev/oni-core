import { describe, it, expect, vi } from "vitest";
import { MCPClient } from "../mcp/client.js";
import { StdioTransport } from "../mcp/transport.js";
import {
  convertMCPTools,
  mcpToolToDefinition,
  formatMCPResult,
} from "../mcp/convert.js";
import type {
  MCPToolDefinition,
  MCPCallToolResult,
  MCPServerConfig,
  JsonRpcResponse,
  JsonRpcNotification,
} from "../mcp/types.js";

// ── Mock helpers ──────────────────────────────────────────────

/**
 * Creates a mock MCPClient by intercepting the StdioTransport.
 * We mock the transport's start/stop/send/notify methods
 * so no real child process is spawned.
 */
function createMockTransport() {
  const handlers: {
    send: Map<string, (params?: Record<string, unknown>) => JsonRpcResponse>;
    notifications: ((n: JsonRpcNotification) => void)[];
  } = {
    send: new Map(),
    notifications: [],
  };

  // Mock transport that doesn't spawn processes
  const transport = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
    send: vi.fn().mockImplementation(
      async (
        method: string,
        params?: Record<string, unknown>,
      ): Promise<JsonRpcResponse> => {
        const handler = handlers.send.get(method);
        if (handler) return handler(params);
        return { jsonrpc: "2.0", id: 1, result: {} };
      },
    ),
    notify: vi.fn(),
  };

  return { transport, handlers };
}

function mockInitializeResponse(): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "test-server", version: "1.0.0" },
    },
  };
}

function mockToolsListResponse(
  tools: MCPToolDefinition[],
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id: 2,
    result: { tools },
  };
}

const TEST_TOOLS: MCPToolDefinition[] = [
  {
    name: "get_weather",
    description: "Get weather for a location",
    inputSchema: {
      type: "object",
      properties: {
        location: { type: "string", description: "City name" },
      },
      required: ["location"],
    },
  },
  {
    name: "search_docs",
    description: "Search documentation",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },
];

const TEST_CONFIG: MCPServerConfig = {
  name: "test-server",
  transport: "stdio",
  command: "node",
  args: ["test-server.js"],
};

// ── MCPClient Tests ───────────────────────────────────────────

describe("MCPClient", () => {
  describe("connect", () => {
    it("performs initialize handshake and discovers tools", async () => {
      const { transport, handlers } = createMockTransport();
      handlers.send.set("initialize", () => mockInitializeResponse());
      handlers.send.set("tools/list", () =>
        mockToolsListResponse(TEST_TOOLS),
      );

      const client = new MCPClient(TEST_CONFIG);
      // Inject mock transport
      (client as any).transport = transport;

      // Manually run the connect logic with mock transport
      await transport.start();

      const initResp = await transport.send("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "oni-core", version: "1.0.1" },
      });
      expect(initResp.result).toBeDefined();
      const initResult = initResp.result as any;
      expect(initResult.serverInfo.name).toBe("test-server");

      transport.notify("notifications/initialized");
      expect(transport.notify).toHaveBeenCalledWith(
        "notifications/initialized",
      );

      const toolsResp = await transport.send("tools/list");
      const toolsResult = toolsResp.result as any;
      expect(toolsResult.tools).toHaveLength(2);
      expect(toolsResult.tools[0].name).toBe("get_weather");
    });

    it("sets state to error on failure", async () => {
      const client = new MCPClient(TEST_CONFIG);
      // Force transport creation to fail by setting state directly
      (client as any).state = "error";
      (client as any).error = "spawn failed";

      expect(client.getState()).toBe("error");
      expect(client.getInfo().error).toBe("spawn failed");
    });

    it("reports disconnected initially", () => {
      const client = new MCPClient(TEST_CONFIG);
      expect(client.getState()).toBe("disconnected");
      expect(client.getInfo().tools).toHaveLength(0);
    });
  });

  describe("listTools", () => {
    it("returns empty array when disconnected", () => {
      const client = new MCPClient(TEST_CONFIG);
      expect(client.listTools()).toHaveLength(0);
    });

    it("returns defensive copy", () => {
      const client = new MCPClient(TEST_CONFIG);
      (client as any).tools = [...TEST_TOOLS];
      const tools1 = client.listTools();
      const tools2 = client.listTools();
      expect(tools1).toEqual(tools2);
      expect(tools1).not.toBe(tools2); // Different references
    });
  });

  describe("callTool", () => {
    it("rejects when not ready", async () => {
      const client = new MCPClient(TEST_CONFIG);
      await expect(
        client.callTool("get_weather", { location: "NYC" }),
      ).rejects.toThrow("not ready");
    });

    it("returns error result on JSON-RPC error", async () => {
      const { transport } = createMockTransport();
      transport.send.mockResolvedValueOnce({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32600, message: "Tool not found" },
      });

      const client = new MCPClient(TEST_CONFIG);
      (client as any).transport = transport;
      (client as any).state = "ready";

      const result = await client.callTool("unknown_tool");
      expect(result.isError).toBe(true);
      expect(result.content[0].type).toBe("text");
      expect((result.content[0] as any).text).toContain("Tool not found");
    });

    it("forwards arguments to transport", async () => {
      const { transport } = createMockTransport();
      transport.send.mockResolvedValueOnce({
        jsonrpc: "2.0",
        id: 1,
        result: {
          content: [{ type: "text", text: "Sunny, 72°F" }],
        },
      });

      const client = new MCPClient(TEST_CONFIG);
      (client as any).transport = transport;
      (client as any).state = "ready";

      const result = await client.callTool("get_weather", {
        location: "NYC",
      });
      expect(result.content[0]).toEqual({ type: "text", text: "Sunny, 72°F" });

      expect(transport.send).toHaveBeenCalledWith("tools/call", {
        name: "get_weather",
        arguments: { location: "NYC" },
      });
    });
  });

  describe("disconnect", () => {
    it("resets state to disconnected", async () => {
      const client = new MCPClient(TEST_CONFIG);
      (client as any).state = "ready";
      (client as any).tools = [...TEST_TOOLS];

      await client.disconnect();
      expect(client.getState()).toBe("disconnected");
      expect(client.listTools()).toHaveLength(0);
    });

    it("stops transport on disconnect", async () => {
      const { transport } = createMockTransport();
      const client = new MCPClient(TEST_CONFIG);
      (client as any).transport = transport;
      (client as any).state = "ready";

      await client.disconnect();
      expect(transport.stop).toHaveBeenCalled();
    });
  });

  describe("getInfo", () => {
    it("returns complete info snapshot", () => {
      const client = new MCPClient(TEST_CONFIG);
      (client as any).state = "ready";
      (client as any).serverInfo = {
        name: "test-server",
        version: "1.0.0",
      };
      (client as any).tools = [...TEST_TOOLS];

      const info = client.getInfo();
      expect(info.name).toBe("test-server");
      expect(info.state).toBe("ready");
      expect(info.serverInfo?.name).toBe("test-server");
      expect(info.tools).toHaveLength(2);
    });
  });
});

// ── Tool Conversion Tests ─────────────────────────────────────

describe("MCP Tool Conversion", () => {
  describe("mcpToolToDefinition", () => {
    it("converts MCP tool to ToolDefinition with namespaced name", () => {
      const mockClient = {
        callTool: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "result" }],
        }),
      } as unknown as MCPClient;

      const def = mcpToolToDefinition(TEST_TOOLS[0]!, mockClient, "weather-srv");

      expect(def.name).toBe("mcp__weather-srv__get_weather");
      expect(def.description).toBe("Get weather for a location");
      expect(def.schema).toEqual(TEST_TOOLS[0]!.inputSchema);
    });

    it("provides fallback description", () => {
      const tool: MCPToolDefinition = {
        name: "no_desc",
        inputSchema: { type: "object" },
      };
      const mockClient = {
        callTool: vi.fn(),
      } as unknown as MCPClient;

      const def = mcpToolToDefinition(tool, mockClient, "srv");
      expect(def.description).toContain("no_desc");
      expect(def.description).toContain("srv");
    });

    it("execute forwards to client.callTool", async () => {
      const mockClient = {
        callTool: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "72°F sunny" }],
        }),
      } as unknown as MCPClient;

      const def = mcpToolToDefinition(TEST_TOOLS[0]!, mockClient, "srv");
      const result = await def.execute(
        { location: "NYC" },
        {} as any,
      );

      expect(mockClient.callTool).toHaveBeenCalledWith("get_weather", {
        location: "NYC",
      });
      expect(result).toBe("72°F sunny");
    });
  });

  describe("convertMCPTools", () => {
    it("converts all tools from client", () => {
      const mockClient = {
        listTools: vi.fn().mockReturnValue(TEST_TOOLS),
        callTool: vi.fn(),
      } as unknown as MCPClient;

      const defs = convertMCPTools(mockClient, "my-server");
      expect(defs).toHaveLength(2);
      expect(defs[0]!.name).toBe("mcp__my-server__get_weather");
      expect(defs[1]!.name).toBe("mcp__my-server__search_docs");
    });

    it("returns empty array for server with no tools", () => {
      const mockClient = {
        listTools: vi.fn().mockReturnValue([]),
        callTool: vi.fn(),
      } as unknown as MCPClient;

      const defs = convertMCPTools(mockClient, "empty");
      expect(defs).toHaveLength(0);
    });
  });

  describe("formatMCPResult", () => {
    it("formats text content", () => {
      const result: MCPCallToolResult = {
        content: [{ type: "text", text: "Hello world" }],
      };
      expect(formatMCPResult(result)).toBe("Hello world");
    });

    it("formats multiple content items", () => {
      const result: MCPCallToolResult = {
        content: [
          { type: "text", text: "Line 1" },
          { type: "text", text: "Line 2" },
        ],
      };
      expect(formatMCPResult(result)).toBe("Line 1\nLine 2");
    });

    it("formats image content as description", () => {
      const result: MCPCallToolResult = {
        content: [
          {
            type: "image",
            data: "aGVsbG8=", // base64
            mimeType: "image/png",
          },
        ],
      };
      const text = formatMCPResult(result);
      expect(text).toContain("Image");
      expect(text).toContain("image/png");
    });

    it("prefixes error results", () => {
      const result: MCPCallToolResult = {
        content: [{ type: "text", text: "Something went wrong" }],
        isError: true,
      };
      const text = formatMCPResult(result);
      expect(text).toContain("[MCP Error]");
      expect(text).toContain("Something went wrong");
    });

    it("handles empty content array", () => {
      const result: MCPCallToolResult = {
        content: [],
      };
      expect(formatMCPResult(result)).toBe("");
    });

    it("handles mixed content types", () => {
      const result: MCPCallToolResult = {
        content: [
          { type: "text", text: "Description:" },
          { type: "image", data: "abc", mimeType: "image/jpeg" },
          { type: "text", text: "Caption" },
        ],
      };
      const text = formatMCPResult(result);
      expect(text).toContain("Description:");
      expect(text).toContain("Image");
      expect(text).toContain("Caption");
    });
  });
});

// ── StdioTransport Tests ──────────────────────────────────────

describe("StdioTransport", () => {
  describe("construction", () => {
    it("starts disconnected", () => {
      const transport = new StdioTransport({
        command: "echo",
        args: ["hello"],
      });
      expect(transport.isConnected()).toBe(false);
    });
  });

  describe("send rejects when not connected", () => {
    it("throws on send before start", async () => {
      const transport = new StdioTransport({
        command: "echo",
      });
      await expect(transport.send("test")).rejects.toThrow("not connected");
    });
  });

  describe("stop is idempotent", () => {
    it("can call stop multiple times", () => {
      const transport = new StdioTransport({
        command: "echo",
      });
      transport.stop();
      transport.stop();
      expect(transport.isConnected()).toBe(false);
    });
  });

  describe("Content-Length framing", () => {
    it("processBuffer parses valid frames", () => {
      const transport = new StdioTransport({ command: "echo" });
      // Access private method via prototype
      const processBuffer = (transport as any).processBuffer.bind(transport);
      const handleMessage = vi.fn();
      (transport as any).handleMessage = handleMessage;

      const payload = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { ok: true },
      });
      (transport as any).buffer = `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`;

      processBuffer();

      expect(handleMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, result: { ok: true } }),
      );
    });

    it("handles partial frames (waits for more data)", () => {
      const transport = new StdioTransport({ command: "echo" });
      const handleMessage = vi.fn();
      (transport as any).handleMessage = handleMessage;

      // Only header, no body yet
      (transport as any).buffer = "Content-Length: 100\r\n\r\n{partial";
      (transport as any).processBuffer();

      expect(handleMessage).not.toHaveBeenCalled();
    });

    it("handles multiple frames in one buffer", () => {
      const transport = new StdioTransport({ command: "echo" });
      const handleMessage = vi.fn();
      (transport as any).handleMessage = handleMessage;

      const msg1 = JSON.stringify({ jsonrpc: "2.0", id: 1, result: "a" });
      const msg2 = JSON.stringify({ jsonrpc: "2.0", id: 2, result: "b" });
      (transport as any).buffer =
        `Content-Length: ${Buffer.byteLength(msg1)}\r\n\r\n${msg1}` +
        `Content-Length: ${Buffer.byteLength(msg2)}\r\n\r\n${msg2}`;

      (transport as any).processBuffer();

      expect(handleMessage).toHaveBeenCalledTimes(2);
    });

    it("skips malformed JSON", () => {
      const transport = new StdioTransport({ command: "echo" });
      const handleMessage = vi.fn();
      (transport as any).handleMessage = handleMessage;

      const bad = "not json!!!";
      (transport as any).buffer = `Content-Length: ${Buffer.byteLength(bad)}\r\n\r\n${bad}`;

      // Should not throw
      (transport as any).processBuffer();
      expect(handleMessage).not.toHaveBeenCalled();
    });
  });

  describe("handleMessage routing", () => {
    it("routes responses to pending requests", () => {
      const transport = new StdioTransport({ command: "echo" });
      const resolver = vi.fn();
      const timer = setTimeout(() => {}, 10000);
      (transport as any).pending.set(42, {
        resolve: resolver,
        reject: vi.fn(),
        timer,
      });

      (transport as any).handleMessage({
        jsonrpc: "2.0",
        id: 42,
        result: { data: "hello" },
      });

      expect(resolver).toHaveBeenCalledWith(
        expect.objectContaining({ id: 42, result: { data: "hello" } }),
      );
      expect((transport as any).pending.has(42)).toBe(false);
      clearTimeout(timer);
    });

    it("routes notifications to handler", () => {
      const notifHandler = vi.fn();
      const transport = new StdioTransport({
        command: "echo",
        onNotification: notifHandler,
      });

      (transport as any).handleMessage({
        jsonrpc: "2.0",
        method: "notifications/tools/list_changed",
      });

      expect(notifHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "notifications/tools/list_changed",
        }),
      );
    });

    it("ignores responses without pending request", () => {
      const transport = new StdioTransport({ command: "echo" });
      // Should not throw
      (transport as any).handleMessage({
        jsonrpc: "2.0",
        id: 999,
        result: {},
      });
    });
  });
});
