/**
 * Regression tests for BUG-0264
 *
 * Incoming JSON-RPC messages from the LSP server were cast directly to typed
 * interfaces via `as unknown as JsonRpcResponse` / `as unknown as
 * JsonRpcNotification` without structural validation. A missing or malformed
 * `id`, absent `result`/`error`, or non-JSON-RPC-2.0 `jsonrpc` field would
 * silently corrupt handler state or leave Promises permanently unresolved.
 *
 * Fix: added a `jsonrpc === "2.0"` gate, validated `id` type, and required
 * at least one of `result` or `error` before resolving pending responses.
 * Merged to main via commit ca43954.
 */
import { describe, it, expect, vi } from "vitest";
import { LSPClient } from "../lsp/client.js";

// Access internal handleMessage via the any escape hatch — this is intentional
// in regression tests that exercise private validation logic.
type InternalClient = {
  handleMessage: (msg: Record<string, unknown>) => void;
  pending: Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout> }>;
};

function makeClient(): LSPClient & InternalClient {
  return new LSPClient(
    { id: "test", command: "echo", args: [], languages: ["typescript"] },
    "/tmp",
  ) as unknown as LSPClient & InternalClient;
}

describe("BUG-0264: LSP client handleMessage — structural validation of incoming JSON-RPC messages", () => {
  it("ignores messages whose jsonrpc field is not '2.0'", () => {
    const client = makeClient();
    const resolve = vi.fn();
    const reject = vi.fn();
    client.pending.set(1, { resolve, reject, timer: setTimeout(() => {}, 30_000) });

    // Simulate a response where jsonrpc is missing or wrong version
    client.handleMessage({ jsonrpc: "1.0", id: 1, result: { ok: true } });

    // Pending request must NOT have been resolved — bad envelope was rejected
    expect(resolve).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();

    clearTimeout(client.pending.get(1)!.timer);
    client.pending.clear();
  });

  it("ignores response messages where id is not a number or string", () => {
    const client = makeClient();
    const resolve = vi.fn();
    client.pending.set(1, { resolve, reject: vi.fn(), timer: setTimeout(() => {}, 30_000) });

    // id is an object — malformed
    client.handleMessage({ jsonrpc: "2.0", id: { nested: 1 }, result: {} });

    expect(resolve).not.toHaveBeenCalled();

    clearTimeout(client.pending.get(1)!.timer);
    client.pending.clear();
  });

  it("ignores response messages that have neither result nor error field", () => {
    const client = makeClient();
    const resolve = vi.fn();
    const reject = vi.fn();
    client.pending.set(5, { resolve, reject, timer: setTimeout(() => {}, 30_000) });

    // Valid id and jsonrpc version but missing both result and error
    client.handleMessage({ jsonrpc: "2.0", id: 5 });

    expect(resolve).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();

    clearTimeout(client.pending.get(5)!.timer);
    client.pending.clear();
  });

  it("resolves a well-formed response with a result field", () => {
    const client = makeClient();
    const resolve = vi.fn();
    const reject = vi.fn();
    client.pending.set(7, { resolve, reject, timer: setTimeout(() => {}, 30_000) });

    // Valid JSON-RPC 2.0 response
    client.handleMessage({ jsonrpc: "2.0", id: 7, result: { capabilities: {} } });

    expect(resolve).toHaveBeenCalledOnce();
    expect(reject).not.toHaveBeenCalled();
  });

  it("resolves a well-formed response with an error field", () => {
    const client = makeClient();
    const resolve = vi.fn();
    const reject = vi.fn();
    client.pending.set(9, { resolve, reject, timer: setTimeout(() => {}, 30_000) });

    // Server-side error is still a valid JSON-RPC response
    client.handleMessage({ jsonrpc: "2.0", id: 9, error: { code: -32600, message: "Invalid Request" } });

    expect(resolve).toHaveBeenCalledOnce();
    expect(reject).not.toHaveBeenCalled();
  });
});
