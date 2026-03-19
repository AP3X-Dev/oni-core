import { describe, it, expect, vi } from "vitest";
import { LSPClient } from "../lsp/client.js";
import type { LSPServerConfig } from "../lsp/types.js";

describe("LSPClient.stop() listener cleanup", () => {
  it("BUG-0016: stop() removes the stdout data listener before killing the process", () => {
    const config: LSPServerConfig = {
      id: "test-server",
      extensions: [".ts"],
      command: "echo",
      args: [],
      languageId: "typescript",
    };

    const client = new LSPClient(config, "/tmp/test");

    // Craft a fake data listener (as would be set by _doStart)
    const fakeListener = vi.fn();

    // Simulate a mock stdout stream
    const removeListenerSpy = vi.fn();
    const removeAllListenersSpy = vi.fn();
    const mockStdout = {
      removeListener: removeListenerSpy,
      removeAllListeners: removeAllListenersSpy,
    };

    // Simulate a mock stderr stream
    const mockStderr = {
      removeAllListeners: vi.fn(),
    };

    // Simulate a mock child process
    const killSpy = vi.fn();
    const removeAllListenersProcSpy = vi.fn();
    const mockProcess = {
      stdout: mockStdout,
      stderr: mockStderr,
      removeAllListeners: removeAllListenersProcSpy,
      kill: killSpy,
      pid: 12345,
    };

    // Inject the fake process and stored listener directly onto the client
    // (bypasses the real _doStart which requires a live spawn)
    const clientAny = client as unknown as Record<string, unknown>;
    clientAny["process"] = mockProcess;
    clientAny["_onStdoutData"] = fakeListener;
    clientAny["state"] = "ready";

    client.stop();

    // The fix: removeListener must be called with the exact stored listener reference
    // before kill(), preventing the closure from keeping the LSPClient alive via GC.
    expect(removeListenerSpy).toHaveBeenCalledWith("data", fakeListener);

    // removeAllListeners must be called on stdout, stderr, and process
    expect(mockStdout.removeAllListeners).toHaveBeenCalledWith("data");
    expect(mockStderr.removeAllListeners).toHaveBeenCalledWith("data");
    expect(removeAllListenersProcSpy).toHaveBeenCalledWith("exit");
    expect(removeAllListenersProcSpy).toHaveBeenCalledWith("error");

    // kill must be called
    expect(killSpy).toHaveBeenCalled();

    // State is disconnected after stop
    expect(client.getState()).toBe("disconnected");

    // _onStdoutData is cleared after stop
    expect(clientAny["_onStdoutData"]).toBeNull();
  });
});
