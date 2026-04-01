import { describe, it, expect, vi, beforeEach } from "vitest";
import { LSPClient } from "../lsp/client.js";
import type {
  LSPLocation,
  LSPDocumentSymbol,
  LSPHover,
  LSPCompletionItem,
  LSPServerConfig,
} from "../lsp/types.js";

const config: LSPServerConfig = {
  id: "test-server",
  extensions: [".ts"],
  command: "echo",
  args: ["test"],
  languageId: "typescript",
};

// ── Not Ready ───────────────────────────────────────────────────

describe("LSPClient request methods (not ready)", () => {
  let client: LSPClient;

  beforeEach(() => {
    client = new LSPClient(config, "/tmp/test");
    // state defaults to "disconnected"
  });

  it("getDefinition returns [] when not ready", async () => {
    const result = await client.getDefinition("/tmp/test/foo.ts", 0, 0);
    expect(result).toEqual([]);
  });

  it("getReferences returns [] when not ready", async () => {
    const result = await client.getReferences("/tmp/test/foo.ts", 0, 0);
    expect(result).toEqual([]);
  });

  it("getDocumentSymbols returns [] when not ready", async () => {
    const result = await client.getDocumentSymbols("/tmp/test/foo.ts");
    expect(result).toEqual([]);
  });

  it("getHover returns null when not ready", async () => {
    const result = await client.getHover("/tmp/test/foo.ts", 0, 0);
    expect(result).toBeNull();
  });

  it("getCompletions returns [] when not ready", async () => {
    const result = await client.getCompletions("/tmp/test/foo.ts", 0, 0);
    expect(result).toEqual([]);
  });
});

// ── Ready (mocked sendRequest) ──────────────────────────────────

describe("LSPClient request methods (ready)", () => {
  let client: LSPClient;
  let mockSendRequest: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new LSPClient(config, "/tmp/test");
    // Force ready state and a tracked file
    (client as any).state = "ready";
    (client as any).fileVersions.set("/tmp/test/foo.ts", 0);

    mockSendRequest = vi.fn();
    (client as any).sendRequest = mockSendRequest;
  });

  it("getDefinition sends textDocument/definition and returns LSPLocation[]", async () => {
    const locations: LSPLocation[] = [
      {
        uri: "file:///tmp/test/bar.ts",
        range: { start: { line: 5, character: 0 }, end: { line: 5, character: 10 } },
      },
    ];
    mockSendRequest.mockResolvedValue({ result: locations });

    const result = await client.getDefinition("/tmp/test/foo.ts", 10, 5);
    expect(mockSendRequest).toHaveBeenCalledWith("textDocument/definition", {
      textDocument: { uri: expect.stringContaining("foo.ts") },
      position: { line: 10, character: 5 },
    });
    expect(result).toEqual(locations);
  });

  it("getReferences sends textDocument/references and returns LSPLocation[]", async () => {
    const locations: LSPLocation[] = [
      {
        uri: "file:///tmp/test/bar.ts",
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
      },
    ];
    mockSendRequest.mockResolvedValue({ result: locations });

    const result = await client.getReferences("/tmp/test/foo.ts", 3, 7);
    expect(mockSendRequest).toHaveBeenCalledWith("textDocument/references", {
      textDocument: { uri: expect.stringContaining("foo.ts") },
      position: { line: 3, character: 7 },
      context: { includeDeclaration: true },
    });
    expect(result).toEqual(locations);
  });

  it("getHover sends textDocument/hover and returns LSPHover", async () => {
    const hover: LSPHover = {
      contents: { kind: "markdown", value: "**string**" },
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
    };
    mockSendRequest.mockResolvedValue({ result: hover });

    const result = await client.getHover("/tmp/test/foo.ts", 0, 2);
    expect(mockSendRequest).toHaveBeenCalledWith("textDocument/hover", {
      textDocument: { uri: expect.stringContaining("foo.ts") },
      position: { line: 0, character: 2 },
    });
    expect(result).toEqual(hover);
  });

  it("getDocumentSymbols sends textDocument/documentSymbol and returns LSPDocumentSymbol[]", async () => {
    const symbols: LSPDocumentSymbol[] = [
      {
        name: "myFunction",
        kind: 12,
        range: { start: { line: 0, character: 0 }, end: { line: 5, character: 1 } },
        selectionRange: { start: { line: 0, character: 9 }, end: { line: 0, character: 19 } },
      },
    ];
    mockSendRequest.mockResolvedValue({ result: symbols });

    const result = await client.getDocumentSymbols("/tmp/test/foo.ts");
    expect(mockSendRequest).toHaveBeenCalledWith("textDocument/documentSymbol", {
      textDocument: { uri: expect.stringContaining("foo.ts") },
    });
    expect(result).toEqual(symbols);
  });

  it("getCompletions handles CompletionItem[] response", async () => {
    const items: LSPCompletionItem[] = [
      { label: "console", kind: 6, detail: "module" },
    ];
    mockSendRequest.mockResolvedValue({ result: items });

    const result = await client.getCompletions("/tmp/test/foo.ts", 1, 3);
    expect(mockSendRequest).toHaveBeenCalledWith("textDocument/completion", {
      textDocument: { uri: expect.stringContaining("foo.ts") },
      position: { line: 1, character: 3 },
    });
    expect(result).toEqual(items);
  });

  it("getCompletions handles CompletionList response", async () => {
    const items: LSPCompletionItem[] = [
      { label: "toString", kind: 2 },
    ];
    mockSendRequest.mockResolvedValue({ result: { items } });

    const result = await client.getCompletions("/tmp/test/foo.ts", 1, 3);
    expect(result).toEqual(items);
  });

  // ── Error Handling ──────────────────────────────────────────

  it("getDefinition returns [] on sendRequest error", async () => {
    mockSendRequest.mockResolvedValue({ error: { code: -1, message: "fail" } });

    const result = await client.getDefinition("/tmp/test/foo.ts", 0, 0);
    expect(result).toEqual([]);
  });

  it("getReferences returns [] on sendRequest error", async () => {
    mockSendRequest.mockResolvedValue({ error: { code: -1, message: "fail" } });

    const result = await client.getReferences("/tmp/test/foo.ts", 0, 0);
    expect(result).toEqual([]);
  });

  it("getDocumentSymbols returns [] on sendRequest error", async () => {
    mockSendRequest.mockResolvedValue({ error: { code: -1, message: "fail" } });

    const result = await client.getDocumentSymbols("/tmp/test/foo.ts");
    expect(result).toEqual([]);
  });

  it("getHover returns null on sendRequest error", async () => {
    mockSendRequest.mockResolvedValue({ error: { code: -1, message: "fail" } });

    const result = await client.getHover("/tmp/test/foo.ts", 0, 0);
    expect(result).toBeNull();
  });

  it("getCompletions returns [] on sendRequest error", async () => {
    mockSendRequest.mockResolvedValue({ error: { code: -1, message: "fail" } });

    const result = await client.getCompletions("/tmp/test/foo.ts", 0, 0);
    expect(result).toEqual([]);
  });

  it("getDefinition returns [] on sendRequest rejection", async () => {
    mockSendRequest.mockRejectedValue(new Error("timeout"));

    const result = await client.getDefinition("/tmp/test/foo.ts", 0, 0);
    expect(result).toEqual([]);
  });

  it("getHover returns null on sendRequest rejection", async () => {
    mockSendRequest.mockRejectedValue(new Error("timeout"));

    const result = await client.getHover("/tmp/test/foo.ts", 0, 0);
    expect(result).toBeNull();
  });
});
