/**
 * Deeper branch-coverage tests for the LSP client (src/lsp/client.ts).
 *
 * These exercise transport-level and lifecycle branches that the happy-path
 * suites do not reach:
 *  - Content-Length frame parsing (missing header, malformed header,
 *    truncated body, multiple frames in one buffer, malformed JSON, oversized
 *    buffer guard)
 *  - JSON-RPC server→client request handling (known requests, configuration,
 *    unsupported method → MethodNotFound)
 *  - Response error-vs-result prioritization
 *  - Pending-request timeout cleanup (fake timers)
 *  - File version tracking + MAX_TRACKED_FILES eviction
 *  - Diagnostics debounce timer reset
 *  - Disconnected-state guards
 *
 * The underlying child process is mocked — no real language server is spawned.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LSPClient } from "../lsp/client.js";
import type { LSPServerConfig } from "../lsp/types.js";

// node:fs cannot be spied on in ESM (namespace is non-configurable), so mock
// the module up front. `readFileSync` is the only export the client uses; tests
// drive its behavior through the `fsReadImpl` hook below.
let fsReadImpl: (path: string) => string = () => "source-code";
vi.mock("node:fs", () => ({
  readFileSync: (path: string) => fsReadImpl(path),
}));

const config: LSPServerConfig = {
  id: "test-server",
  extensions: [".ts"],
  command: "echo",
  args: ["test"],
  languageId: "typescript",
};

// Internal surface we poke at via the documented `any` escape hatch (same
// approach as lsp-client-message-validation.test.ts).
type Internal = {
  buffer: Buffer;
  processBuffer: () => void;
  handleMessage: (msg: Record<string, unknown>) => void;
  handleNotification: (n: Record<string, unknown>) => void;
  handleProcessExit: () => void;
  notifyDiagnosticsWaiters: (filePath: string) => void;
  waitForDiagnostics: (filePath: string) => Promise<void>;
  sendRequest: (
    method: string,
    params?: unknown,
    timeoutMs?: number,
  ) => Promise<unknown>;
  writeMessage: (msg: Record<string, unknown>) => void;
  pending: Map<
    number,
    {
      resolve: (v: unknown) => void;
      reject: (e: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >;
  diagnosticsCache: Map<string, unknown[]>;
  diagnosticsWaiters: Map<string, unknown[]>;
  fileVersions: Map<string, number>;
  state: string;
  process: unknown;
};

function makeClient(): LSPClient & Internal {
  return new LSPClient(config, "/tmp/test") as unknown as LSPClient & Internal;
}

/** Build a single Content-Length framed message for a JSON payload. */
function frame(obj: unknown): Buffer {
  const json = JSON.stringify(obj);
  const header = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`;
  return Buffer.concat([Buffer.from(header, "utf-8"), Buffer.from(json, "utf-8")]);
}

// ── Content-Length frame parsing ─────────────────────────────────

describe("processBuffer — Content-Length frame parsing", () => {
  it("does nothing when no header terminator (\\r\\n\\r\\n) is present", () => {
    const client = makeClient();
    const spy = vi.spyOn(client as Internal, "handleMessage" as never);
    client.buffer = Buffer.from("Content-Length: 10\r\n", "utf-8"); // header not terminated
    client.processBuffer();
    expect(spy).not.toHaveBeenCalled();
    // Buffer must be left intact so a later chunk can complete the frame.
    expect(client.buffer.length).toBe(Buffer.byteLength("Content-Length: 10\r\n"));
  });

  it("skips a malformed header that has no Content-Length and continues", () => {
    const client = makeClient();
    const handled: unknown[] = [];
    vi.spyOn(client as Internal, "handleMessage" as never).mockImplementation(
      ((m: unknown) => {
        handled.push(m);
      }) as never,
    );

    const good = frame({ jsonrpc: "2.0", method: "x" });
    // A bogus header block (no Content-Length) followed by a valid frame.
    const bogus = Buffer.from("X-Whatever: nope\r\n\r\n", "utf-8");
    client.buffer = Buffer.concat([bogus, good]);
    client.processBuffer();

    expect(handled).toHaveLength(1);
    expect((handled[0] as Record<string, unknown>).method).toBe("x");
    expect(client.buffer.length).toBe(0);
  });

  it("waits (break) when the body is truncated, then completes on next chunk", () => {
    const client = makeClient();
    const handled: unknown[] = [];
    vi.spyOn(client as Internal, "handleMessage" as never).mockImplementation(
      ((m: unknown) => {
        handled.push(m);
      }) as never,
    );

    const full = frame({ jsonrpc: "2.0", method: "ping" });
    // Deliver everything except the final byte → incomplete body.
    client.buffer = full.subarray(0, full.length - 1);
    client.processBuffer();
    expect(handled).toHaveLength(0);
    // The incomplete frame must remain buffered.
    expect(client.buffer.length).toBe(full.length - 1);

    // Now deliver the remaining byte.
    client.buffer = Buffer.concat([client.buffer, full.subarray(full.length - 1)]);
    client.processBuffer();
    expect(handled).toHaveLength(1);
    expect(client.buffer.length).toBe(0);
  });

  it("parses multiple frames present in a single buffer", () => {
    const client = makeClient();
    const handled: Record<string, unknown>[] = [];
    vi.spyOn(client as Internal, "handleMessage" as never).mockImplementation(
      ((m: unknown) => {
        handled.push(m as Record<string, unknown>);
      }) as never,
    );

    client.buffer = Buffer.concat([
      frame({ jsonrpc: "2.0", method: "a" }),
      frame({ jsonrpc: "2.0", method: "b" }),
      frame({ jsonrpc: "2.0", method: "c" }),
    ]);
    client.processBuffer();

    expect(handled.map((m) => m.method)).toEqual(["a", "b", "c"]);
    expect(client.buffer.length).toBe(0);
  });

  it("swallows a frame whose body is not valid JSON but consumes it", () => {
    const client = makeClient();
    const spy = vi.spyOn(client as Internal, "handleMessage" as never);

    const bad = "this-is-not-json";
    const header = `Content-Length: ${Buffer.byteLength(bad)}\r\n\r\n`;
    const badFrame = Buffer.from(header + bad, "utf-8");
    const goodFrame = frame({ jsonrpc: "2.0", method: "after" });
    client.buffer = Buffer.concat([badFrame, goodFrame]);
    client.processBuffer();

    // Bad JSON does not reach handleMessage, but the good one after it does.
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0]![0] as Record<string, unknown>).method).toBe("after");
    expect(client.buffer.length).toBe(0);
  });

  it("respects byte length for multi-byte UTF-8 content", () => {
    const client = makeClient();
    const handled: Record<string, unknown>[] = [];
    vi.spyOn(client as Internal, "handleMessage" as never).mockImplementation(
      ((m: unknown) => {
        handled.push(m as Record<string, unknown>);
      }) as never,
    );

    // "🚀" is 4 bytes but 2 UTF-16 code units — frame() uses byteLength so this
    // exercises the byte-correct slicing path.
    client.buffer = frame({ jsonrpc: "2.0", method: "emoji", params: "🚀ok" });
    client.processBuffer();

    expect(handled).toHaveLength(1);
    expect(handled[0]!.params).toBe("🚀ok");
    expect(client.buffer.length).toBe(0);
  });

  it("disconnects and clears buffer when the oversized 64 MB guard trips", () => {
    const client = makeClient();
    const stopSpy = vi.spyOn(client, "stop");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Allocate just over the 64 MB cap. alloc is zero-filled (cheap, no copy).
    client.buffer = Buffer.alloc(64 * 1024 * 1024 + 1);
    client.processBuffer();

    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(client.buffer.length).toBe(0);
    errSpy.mockRestore();
  });
});

// ── JSON-RPC response error-vs-result prioritization ─────────────

describe("handleMessage — response result/error handling", () => {
  it("includes both result and error fields when the server sends both", () => {
    const client = makeClient();
    let captured: unknown;
    client.pending.set(42, {
      resolve: (v) => {
        captured = v;
      },
      reject: vi.fn(),
      timer: setTimeout(() => {}, 30_000),
    });

    client.handleMessage({
      jsonrpc: "2.0",
      id: 42,
      result: { ok: true },
      error: { code: -1, message: "weird" },
    });

    const r = captured as Record<string, unknown>;
    expect(r.id).toBe(42);
    // The constructed response carries both fields verbatim.
    expect(r.result).toEqual({ ok: true });
    expect(r.error).toEqual({ code: -1, message: "weird" });
    expect(client.pending.has(42)).toBe(false);
  });

  it("clears the pending timer and removes the entry on resolution", () => {
    const client = makeClient();
    const timer = setTimeout(() => {}, 30_000);
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    client.pending.set(3, { resolve: vi.fn(), reject: vi.fn(), timer });

    client.handleMessage({ jsonrpc: "2.0", id: 3, result: 1 });

    expect(clearSpy).toHaveBeenCalledWith(timer);
    expect(client.pending.has(3)).toBe(false);
    clearSpy.mockRestore();
  });

  it("ignores a response whose id has no matching pending request", () => {
    const client = makeClient();
    // No pending entry for id 99 — must not throw.
    expect(() =>
      client.handleMessage({ jsonrpc: "2.0", id: 99, result: {} }),
    ).not.toThrow();
  });
});

// ── Server → client requests ─────────────────────────────────────

describe("handleMessage — server-initiated requests", () => {
  it("replies with null result to window/workDoneProgress/create", () => {
    const client = makeClient();
    const writeSpy = vi
      .spyOn(client as Internal, "writeMessage" as never)
      .mockImplementation((() => {}) as never);

    client.handleMessage({
      jsonrpc: "2.0",
      id: 10,
      method: "window/workDoneProgress/create",
      params: {},
    });

    expect(writeSpy).toHaveBeenCalledWith({ jsonrpc: "2.0", id: 10, result: null });
  });

  it("replies with null to client/registerCapability and unregisterCapability", () => {
    const client = makeClient();
    const writeSpy = vi
      .spyOn(client as Internal, "writeMessage" as never)
      .mockImplementation((() => {}) as never);

    client.handleMessage({ jsonrpc: "2.0", id: 11, method: "client/registerCapability" });
    client.handleMessage({ jsonrpc: "2.0", id: 12, method: "client/unregisterCapability" });

    expect(writeSpy).toHaveBeenCalledWith({ jsonrpc: "2.0", id: 11, result: null });
    expect(writeSpy).toHaveBeenCalledWith({ jsonrpc: "2.0", id: 12, result: null });
  });

  it("returns one init-options entry per requested item for workspace/configuration", () => {
    const cfg: LSPServerConfig = { ...config, initializationOptions: { setting: "x" } };
    const client = new LSPClient(cfg, "/tmp/test") as unknown as LSPClient & Internal;
    const writeSpy = vi
      .spyOn(client as Internal, "writeMessage" as never)
      .mockImplementation((() => {}) as never);

    client.handleMessage({
      jsonrpc: "2.0",
      id: 20,
      method: "workspace/configuration",
      params: { items: [{ section: "a" }, { section: "b" }] },
    });

    expect(writeSpy).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      id: 20,
      result: [{ setting: "x" }, { setting: "x" }],
    });
  });

  it("defaults to empty object items and {} options when configuration params are absent", () => {
    const client = makeClient(); // no initializationOptions on base config
    const writeSpy = vi
      .spyOn(client as Internal, "writeMessage" as never)
      .mockImplementation((() => {}) as never);

    client.handleMessage({ jsonrpc: "2.0", id: 21, method: "workspace/configuration" });

    expect(writeSpy).toHaveBeenCalledWith({ jsonrpc: "2.0", id: 21, result: [] });
  });

  it("replies MethodNotFound (-32601) to an unsupported server request", () => {
    const client = makeClient();
    const writeSpy = vi
      .spyOn(client as Internal, "writeMessage" as never)
      .mockImplementation((() => {}) as never);

    client.handleMessage({ jsonrpc: "2.0", id: 30, method: "some/unknownRequest" });

    expect(writeSpy).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      id: 30,
      error: { code: -32601, message: "Method not supported: some/unknownRequest" },
    });
  });
});

// ── Notification validation ──────────────────────────────────────

describe("handleMessage — notifications", () => {
  it("dispatches a notification with no id to handleNotification", () => {
    const client = makeClient();
    const notifySpy = vi
      .spyOn(client as Internal, "handleNotification" as never)
      .mockImplementation((() => {}) as never);

    client.handleMessage({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: {} });

    expect(notifySpy).toHaveBeenCalledTimes(1);
    const arg = notifySpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.method).toBe("textDocument/publishDiagnostics");
  });

  it("ignores a notification whose method is not a string", () => {
    const client = makeClient();
    const notifySpy = vi.spyOn(client as Internal, "handleNotification" as never);

    // method present but a number — handleMessage's notification branch rejects it
    client.handleMessage({ jsonrpc: "2.0", method: 123 });

    expect(notifySpy).not.toHaveBeenCalled();
  });

  it("ignores a response with id === null (no pending lookup, falls through)", () => {
    const client = makeClient();
    const notifySpy = vi.spyOn(client as Internal, "handleNotification" as never);
    // id is null and there is no method → nothing should happen.
    client.handleMessage({ jsonrpc: "2.0", id: null, result: {} });
    expect(notifySpy).not.toHaveBeenCalled();
  });
});

// ── Diagnostics cache + URI mapping + eviction ───────────────────

describe("handleNotification — publishDiagnostics", () => {
  it("caches diagnostics keyed by the resolved file path and notifies waiters", () => {
    const client = makeClient();
    const notifySpy = vi
      .spyOn(client as Internal, "notifyDiagnosticsWaiters" as never)
      .mockImplementation((() => {}) as never);

    const uri = "file:///tmp/test/foo.ts";
    client.handleNotification({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: { uri, diagnostics: [{ message: "boom", range: {} }] },
    });

    // uriToPath strips the file:// scheme.
    const cached = client.diagnosticsCache.get("/tmp/test/foo.ts");
    expect(cached).toEqual([{ message: "boom", range: {} }]);
    expect(notifySpy).toHaveBeenCalledWith("/tmp/test/foo.ts");
  });

  it("falls back to the raw uri string when it is not a valid URL", () => {
    const client = makeClient();
    vi.spyOn(client as Internal, "notifyDiagnosticsWaiters" as never).mockImplementation(
      (() => {}) as never,
    );

    client.handleNotification({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: { uri: "not a uri", diagnostics: [] },
    });

    expect(client.diagnosticsCache.has("not a uri")).toBe(true);
  });

  it("ignores non-diagnostics notifications", () => {
    const client = makeClient();
    client.handleNotification({
      jsonrpc: "2.0",
      method: "window/logMessage",
      params: { message: "hi" },
    });
    expect(client.diagnosticsCache.size).toBe(0);
  });
});

// ── sendRequest — disconnected guard & timeout cleanup ───────────

describe("sendRequest — guards and timeout", () => {
  it("rejects immediately when the process stdin is not writable", async () => {
    const client = makeClient();
    // process is null by default → not connected
    await expect(client.sendRequest("initialize", {})).rejects.toThrow(
      /LSP process not connected/,
    );
  });

  it("rejects and removes the pending entry when the request times out", async () => {
    vi.useFakeTimers();
    try {
      const client = makeClient();
      // Fake a writable stdin so the request is actually enqueued.
      const written: string[] = [];
      client.process = {
        stdin: { writable: true, write: (s: string) => written.push(s) },
      } as unknown as Internal["process"];

      const promise = client.sendRequest("textDocument/hover", {}, 5_000);
      // The pending map should now hold one entry.
      expect(client.pending.size).toBe(1);

      const assertion = expect(promise).rejects.toThrow(
        /LSP request "textDocument\/hover" timed out after 5000ms/,
      );
      // Advance past the timeout to trip the cleanup timer.
      await vi.advanceTimersByTimeAsync(5_000);
      await assertion;

      // The timed-out request must be evicted from pending.
      expect(client.pending.size).toBe(0);
      expect(written.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── File version tracking + eviction (touchFile) ─────────────────

describe("touchFile — version tracking and MAX_TRACKED_FILES eviction", () => {
  beforeEach(() => {
    fsReadImpl = () => "source-code";
  });

  it("is a no-op when the client is not ready", async () => {
    const client = makeClient();
    const sendNotif = vi.spyOn(client as never, "sendNotification" as never);
    // state defaults to "disconnected"
    await client.touchFile("/tmp/test/foo.ts");
    expect(sendNotif).not.toHaveBeenCalled();
    expect(client.fileVersions.size).toBe(0);
  });

  it("sends didOpen on first touch (version 0) and didChange (version+1) afterwards", async () => {
    const client = makeClient();
    client.state = "ready";
    const notifications: Array<{ method: string; params: unknown }> = [];
    vi.spyOn(client as never, "sendNotification" as never).mockImplementation(
      ((method: string, params: unknown) => {
        notifications.push({ method, params });
      }) as never,
    );

    fsReadImpl = () => "source-code";

    await client.touchFile("/tmp/test/a.ts");
    expect(client.fileVersions.get("/tmp/test/a.ts")).toBe(0);
    expect(notifications[0]!.method).toBe("textDocument/didOpen");

    await client.touchFile("/tmp/test/a.ts");
    expect(client.fileVersions.get("/tmp/test/a.ts")).toBe(1);
    expect(notifications[1]!.method).toBe("textDocument/didChange");
    expect((notifications[1]!.params as { textDocument: { version: number } }).textDocument.version).toBe(1);
  });

  it("returns silently when the file cannot be read (no version recorded)", async () => {
    const client = makeClient();
    client.state = "ready";
    const sendNotif = vi.spyOn(client as never, "sendNotification" as never);
    fsReadImpl = () => {
      throw new Error("ENOENT");
    };

    await client.touchFile("/tmp/test/missing.ts");
    expect(client.fileVersions.has("/tmp/test/missing.ts")).toBe(false);
    expect(sendNotif).not.toHaveBeenCalled();
  });

  it("evicts the oldest tracked file once MAX_TRACKED_FILES is reached", async () => {
    const client = makeClient();
    client.state = "ready";
    vi.spyOn(client as never, "sendNotification" as never).mockImplementation(
      (() => {}) as never,
    );
    fsReadImpl = () => "x";

    // Pre-fill the map to exactly the cap (2000) with synthetic entries.
    const MAX = 2_000;
    for (let i = 0; i < MAX; i++) {
      client.fileVersions.set(`/old/file-${i}.ts`, 0);
    }
    expect(client.fileVersions.size).toBe(MAX);
    const oldestKey = client.fileVersions.keys().next().value as string;
    expect(oldestKey).toBe("/old/file-0.ts");

    // Touching a brand-new file should evict exactly one (the oldest) entry.
    await client.touchFile("/tmp/test/new.ts");
    expect(client.fileVersions.has("/old/file-0.ts")).toBe(false);
    expect(client.fileVersions.has("/tmp/test/new.ts")).toBe(true);
    expect(client.fileVersions.size).toBe(MAX);
  });
});

// ── Diagnostics debounce timer reset ─────────────────────────────

describe("notifyDiagnosticsWaiters — debounce reset", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves a waiter only after the 150ms debounce settles", async () => {
    const client = makeClient();
    let resolved = false;
    const p = client.waitForDiagnostics("/tmp/test/x.ts").then(() => {
      resolved = true;
    });

    // First diagnostics arrival arms the debounce timer.
    client.notifyDiagnosticsWaiters("/tmp/test/x.ts");
    await vi.advanceTimersByTimeAsync(100);
    expect(resolved).toBe(false); // debounce not yet elapsed

    // Settle the remaining debounce window.
    await vi.advanceTimersByTimeAsync(60);
    await p;
    expect(resolved).toBe(true);
  });

  it("resets the debounce window when diagnostics arrive again before it fires", async () => {
    const client = makeClient();
    let resolved = false;
    const p = client.waitForDiagnostics("/tmp/test/y.ts").then(() => {
      resolved = true;
    });

    client.notifyDiagnosticsWaiters("/tmp/test/y.ts");
    await vi.advanceTimersByTimeAsync(100);
    // Second arrival before 150ms resets the timer back to 0.
    client.notifyDiagnosticsWaiters("/tmp/test/y.ts");
    await vi.advanceTimersByTimeAsync(100);
    expect(resolved).toBe(false); // would have resolved at 150 without the reset

    await vi.advanceTimersByTimeAsync(60); // now 160ms since the second arrival
    await p;
    expect(resolved).toBe(true);
  });

  it("is a no-op when there are no waiters for the file", () => {
    const client = makeClient();
    expect(() => client.notifyDiagnosticsWaiters("/tmp/test/none.ts")).not.toThrow();
  });

  it("resolves the waiter via the overall timeout (3s) when no diagnostics arrive", async () => {
    const client = makeClient();
    let resolved = false;
    const p = client.waitForDiagnostics("/tmp/test/z.ts").then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(3_000);
    await p;
    expect(resolved).toBe(true);
    // Overall timeout removes the waiter from the map.
    expect(client.diagnosticsWaiters.has("/tmp/test/z.ts")).toBe(false);
  });
});

// ── Disconnected-state guards on request methods ─────────────────

describe("request methods — disconnected guards", () => {
  let client: LSPClient;

  beforeEach(() => {
    client = new LSPClient(config, "/tmp/test"); // disconnected
  });

  it("getDefinition / getReferences / getDocumentSymbols return [] when not ready", async () => {
    expect(await client.getDefinition("/tmp/test/a.ts", 0, 0)).toEqual([]);
    expect(await client.getReferences("/tmp/test/a.ts", 0, 0)).toEqual([]);
    expect(await client.getDocumentSymbols("/tmp/test/a.ts")).toEqual([]);
  });

  it("getHover returns null and getCompletions returns [] when not ready", async () => {
    expect(await client.getHover("/tmp/test/a.ts", 0, 0)).toBeNull();
    expect(await client.getCompletions("/tmp/test/a.ts", 0, 0)).toEqual([]);
  });

  it("getCompletions normalizes a CompletionList object shape when ready", async () => {
    const c = client as unknown as Internal;
    c.state = "ready";
    c.fileVersions.set("/tmp/test/a.ts", 0);
    vi.spyOn(c, "sendRequest" as never).mockResolvedValue({
      result: { items: [{ label: "x" }] },
    } as never);

    const out = await client.getCompletions("/tmp/test/a.ts", 0, 0);
    expect(out).toEqual([{ label: "x" }]);
  });

  it("getCompletions returns [] for an unrecognized result shape when ready", async () => {
    const c = client as unknown as Internal;
    c.state = "ready";
    c.fileVersions.set("/tmp/test/a.ts", 0);
    // Truthy object with no `items` key → falls through to [].
    vi.spyOn(c, "sendRequest" as never).mockResolvedValue({ result: { weird: 1 } } as never);

    const out = await client.getCompletions("/tmp/test/a.ts", 0, 0);
    expect(out).toEqual([]);
  });
});

// ── Process exit / pending rejection ─────────────────────────────

describe("handleProcessExit — pending rejection and state transition", () => {
  it("marks a ready client broken and rejects all pending requests", () => {
    const client = makeClient();
    client.state = "ready";
    const reject = vi.fn();
    const timer = setTimeout(() => {}, 30_000);
    client.pending.set(1, { resolve: vi.fn(), reject, timer });

    client.handleProcessExit();

    expect(client.state).toBe("broken");
    expect(reject).toHaveBeenCalledTimes(1);
    expect((reject.mock.calls[0]![0] as Error).message).toBe("LSP server exited");
    expect(client.pending.size).toBe(0);
    expect(client.process).toBeNull();
  });

  it("leaves a disconnected client as-is (does not flip to broken)", () => {
    const client = makeClient();
    client.state = "disconnected";
    client.handleProcessExit();
    // Only "ready"/"connecting" transition to broken on exit.
    expect(client.state).toBe("disconnected");
  });
});

// ── stop() cleanup ───────────────────────────────────────────────

describe("stop — clears tracked state", () => {
  it("rejects pending, clears caches/versions, and resets to disconnected", () => {
    const client = makeClient();
    client.state = "ready";
    const reject = vi.fn();
    client.pending.set(1, { resolve: vi.fn(), reject, timer: setTimeout(() => {}, 30_000) });
    client.fileVersions.set("/tmp/test/a.ts", 3);
    client.diagnosticsCache.set("/tmp/test/a.ts", [{ message: "m", range: {} }]);

    client.stop();

    expect(reject).toHaveBeenCalledTimes(1);
    expect((reject.mock.calls[0]![0] as Error).message).toBe("LSP client stopping");
    expect(client.getState()).toBe("disconnected");
    expect(client.fileVersions.size).toBe(0);
    expect(client.diagnosticsCache.size).toBe(0);
  });
});
