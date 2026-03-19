import { describe, it, expect, vi } from "vitest";
import { MCPClient } from "../mcp/client.js";
import type { MCPServerConfig, JsonRpcResponse } from "../mcp/types.js";

const TEST_CONFIG: MCPServerConfig = {
  name: "test-server",
  transport: "stdio",
  command: "node",
  args: ["test-server.js"],
};

function makeTransport(toolsListDelay = 0) {
  let sendCallCount = 0;

  const transport = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
    send: vi.fn().mockImplementation(
      async (method: string): Promise<JsonRpcResponse> => {
        if (method === "tools/list") {
          sendCallCount++;
          if (toolsListDelay > 0) {
            await new Promise((r) => setTimeout(r, toolsListDelay));
          }
          return {
            jsonrpc: "2.0",
            id: 1,
            result: {
              tools: [{ name: "tool_a", description: "Tool A", inputSchema: { type: "object" } }],
            },
          };
        }
        return { jsonrpc: "2.0", id: 1, result: {} };
      },
    ),
    notify: vi.fn(),
    getCallCount: () => sendCallCount,
  };

  return transport;
}

describe("MCPClient.refreshTools coalescing (BUG-0247)", () => {
  it("BUG-0247: concurrent refreshTools() calls are coalesced into a single tools/list request", async () => {
    // Before the fix, _refreshLock was set AFTER the IIFE was created but AFTER the
    // synchronous portion ran, leaving a window where concurrent callers could
    // each start a separate tools/list request.
    // The fix ensures _refreshLock is set synchronously before any await point,
    // so concurrent callers always see the lock and wait on the shared promise.

    const transport = makeTransport(10); // 10ms delay to widen race window
    const client = new MCPClient(TEST_CONFIG);
    (client as any).transport = transport;

    // Fire three concurrent refreshTools() calls
    const [p1, p2, p3] = [
      client.refreshTools(),
      client.refreshTools(),
      client.refreshTools(),
    ];

    await Promise.all([p1, p2, p3]);

    // Only ONE tools/list request should have been sent to the server
    expect(transport.getCallCount()).toBe(1);
    // Tools should be correctly populated
    expect(client.listTools()).toHaveLength(1);
    expect(client.listTools()[0]!.name).toBe("tool_a");
  });

  it("BUG-0247: _refreshLock is cleared after completion, allowing a subsequent refresh", async () => {
    const transport = makeTransport(0);
    const client = new MCPClient(TEST_CONFIG);
    (client as any).transport = transport;

    await client.refreshTools();
    // Lock should be null after completion
    expect((client as any)._refreshLock).toBeNull();

    // A subsequent call must succeed and send exactly one more request
    await client.refreshTools();
    expect(transport.getCallCount()).toBe(2);
  });

  it("BUG-0247: lock is cleared even when tools/list request fails", async () => {
    const transport = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      isConnected: vi.fn().mockReturnValue(true),
      send: vi.fn().mockResolvedValue({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32603, message: "tools/list internal error" },
      }),
      notify: vi.fn(),
    };

    const client = new MCPClient(TEST_CONFIG);
    (client as any).transport = transport;

    await expect(client.refreshTools()).rejects.toThrow("tools/list");

    // Lock must be cleared so future calls are not permanently blocked
    expect((client as any)._refreshLock).toBeNull();
  });
});
