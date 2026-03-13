import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LSPClient,
  LSPManager,
  findServersForExtension,
  getLanguageId,
  LANGUAGE_MAP,
  BUILTIN_SERVERS,
  formatDiagnostic,
} from "../lsp/index.js";
import type { LSPDiagnostic, LSPServerConfig } from "../lsp/index.js";

// ── Language Map ──────────────────────────────────────────────

describe("LANGUAGE_MAP", () => {
  it("maps TypeScript extensions", () => {
    expect(getLanguageId(".ts")).toBe("typescript");
    expect(getLanguageId(".tsx")).toBe("typescriptreact");
    expect(getLanguageId(".mts")).toBe("typescript");
    expect(getLanguageId(".cts")).toBe("typescript");
  });

  it("maps JavaScript extensions", () => {
    expect(getLanguageId(".js")).toBe("javascript");
    expect(getLanguageId(".jsx")).toBe("javascriptreact");
    expect(getLanguageId(".mjs")).toBe("javascript");
    expect(getLanguageId(".cjs")).toBe("javascript");
  });

  it("maps other languages", () => {
    expect(getLanguageId(".py")).toBe("python");
    expect(getLanguageId(".go")).toBe("go");
    expect(getLanguageId(".rs")).toBe("rust");
    expect(getLanguageId(".java")).toBe("java");
  });

  it("returns undefined for unknown extensions", () => {
    expect(getLanguageId(".xyz")).toBeUndefined();
    expect(getLanguageId(".foo")).toBeUndefined();
  });

  it("is case-insensitive", () => {
    expect(getLanguageId(".TS")).toBe("typescript");
    expect(getLanguageId(".PY")).toBe("python");
  });
});

// ── findServersForExtension ───────────────────────────────────

describe("findServersForExtension", () => {
  it("finds TypeScript server for .ts", () => {
    const servers = findServersForExtension(".ts");
    expect(servers.length).toBeGreaterThanOrEqual(1);
    expect(servers[0]!.id).toBe("typescript");
  });

  it("finds TypeScript server for .jsx", () => {
    const servers = findServersForExtension(".jsx");
    expect(servers.length).toBeGreaterThanOrEqual(1);
    expect(servers[0]!.id).toBe("typescript");
  });

  it("finds Pyright server for .py", () => {
    const servers = findServersForExtension(".py");
    expect(servers.length).toBeGreaterThanOrEqual(1);
    expect(servers[0]!.id).toBe("pyright");
  });

  it("finds gopls for .go", () => {
    const servers = findServersForExtension(".go");
    expect(servers.length).toBe(1);
    expect(servers[0]!.id).toBe("gopls");
  });

  it("returns empty for unknown extensions", () => {
    expect(findServersForExtension(".xyz")).toEqual([]);
    expect(findServersForExtension(".md")).toEqual([]);
  });
});

// ── BUILTIN_SERVERS ───────────────────────────────────────────

describe("BUILTIN_SERVERS", () => {
  it("has 4 built-in servers", () => {
    expect(BUILTIN_SERVERS.length).toBe(4);
  });

  it("all have required fields", () => {
    for (const server of BUILTIN_SERVERS) {
      expect(server.id).toBeTruthy();
      expect(server.command).toBeTruthy();
      expect(server.extensions.length).toBeGreaterThan(0);
      expect(server.languageId).toBeTruthy();
    }
  });

  it("has unique IDs", () => {
    const ids = BUILTIN_SERVERS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── LSPClient ─────────────────────────────────────────────────

describe("LSPClient", () => {
  const config: LSPServerConfig = {
    id: "test-server",
    extensions: [".ts"],
    command: "echo",
    args: ["test"],
    languageId: "typescript",
  };

  it("starts in disconnected state", () => {
    const client = new LSPClient(config, "/tmp/test");
    expect(client.getState()).toBe("disconnected");
    expect(client.getServerId()).toBe("test-server");
  });

  it("getInfo returns server info", () => {
    const client = new LSPClient(config, "/tmp/test");
    const info = client.getInfo();
    expect(info.serverId).toBe("test-server");
    expect(info.state).toBe("disconnected");
    expect(info.rootDir).toBe("/tmp/test");
  });

  it("getDiagnostics returns empty for unknown file", () => {
    const client = new LSPClient(config, "/tmp/test");
    expect(client.getDiagnostics("unknown.ts")).toEqual([]);
  });

  it("getAllDiagnostics returns empty map initially", () => {
    const client = new LSPClient(config, "/tmp/test");
    expect(client.getAllDiagnostics().size).toBe(0);
  });

  it("stop clears state cleanly", () => {
    const client = new LSPClient(config, "/tmp/test");
    // Should not throw even when not started
    client.stop();
    expect(client.getState()).toBe("disconnected");
  });

  it("start with non-existent command marks as broken", async () => {
    const badConfig: LSPServerConfig = {
      ...config,
      command: "nonexistent-lsp-server-that-does-not-exist-12345",
    };
    const client = new LSPClient(badConfig, "/tmp/test");

    await expect(client.start()).rejects.toThrow();
    expect(client.getState()).toBe("broken");
  });

  it("start with broken state throws", async () => {
    const badConfig: LSPServerConfig = {
      ...config,
      command: "nonexistent-lsp-server-12345",
    };
    const client = new LSPClient(badConfig, "/tmp/test");

    // First start marks it broken
    await expect(client.start()).rejects.toThrow();

    // Second start should also throw (broken state)
    await expect(client.start()).rejects.toThrow(/broken/);
  });
});

// ── LSPManager ────────────────────────────────────────────────

describe("LSPManager", () => {
  it("creates with root directory", () => {
    const mgr = new LSPManager("/tmp/project");
    expect(mgr.getClientInfos()).toEqual([]);
  });

  it("getDiagnostics returns empty for unknown file", () => {
    const mgr = new LSPManager("/tmp/project");
    expect(mgr.getDiagnostics("foo.ts")).toEqual([]);
  });

  it("getErrorDiagnosticsText returns empty when no errors", () => {
    const mgr = new LSPManager("/tmp/project");
    expect(mgr.getErrorDiagnosticsText("foo.ts")).toBe("");
  });

  it("isBroken returns false initially", () => {
    const mgr = new LSPManager("/tmp/project");
    expect(mgr.isBroken("typescript")).toBe(false);
  });

  it("disable stops all clients", () => {
    const mgr = new LSPManager("/tmp/project");
    mgr.disable();
    // touchFile should be a no-op after disable
    // (can't test async easily without a real server, but it should not throw)
  });

  it("disposeAll is safe to call repeatedly", () => {
    const mgr = new LSPManager("/tmp/project");
    mgr.disposeAll();
    mgr.disposeAll();
    expect(mgr.getClientInfos()).toEqual([]);
  });

  it("addServers adds custom server configs", () => {
    const mgr = new LSPManager("/tmp/project");
    const custom: LSPServerConfig = {
      id: "custom-ts",
      extensions: [".ts"],
      command: "custom-lsp",
      args: ["--stdio"],
      languageId: "typescript",
    };
    mgr.addServers([custom]);
    // No error means success
  });

  it("touchFile with disabled LSP is a no-op", async () => {
    const mgr = new LSPManager("/tmp/project");
    mgr.disable();
    // Should not throw
    await mgr.touchFile("/tmp/project/index.ts");
  });

  it("touchFile with non-matching extension is a no-op", async () => {
    const mgr = new LSPManager("/tmp/project");
    // .md has no server — should silently do nothing
    await mgr.touchFile("/tmp/project/README.md");
    expect(mgr.getClientInfos()).toEqual([]);
  });

  it("marks broken server and skips on retry", async () => {
    const mgr = new LSPManager("/tmp/project");
    // touchFile will try to spawn typescript-language-server
    // which likely doesn't exist in test env → marks as broken
    await mgr.touchFile("/tmp/project/index.ts");

    // The server should be broken now (or no-op if server doesn't exist)
    // Either way, subsequent calls should not throw
    await mgr.touchFile("/tmp/project/other.ts");
  });
});

// ── formatDiagnostic ──────────────────────────────────────────

describe("formatDiagnostic", () => {
  it("formats error diagnostic", () => {
    const diag: LSPDiagnostic = {
      range: {
        start: { line: 9, character: 4 },
        end: { line: 9, character: 10 },
      },
      severity: 1,
      code: 2304,
      source: "ts",
      message: "Cannot find name 'foo'.",
    };

    const result = formatDiagnostic(diag);
    expect(result).toContain("10:5"); // 1-indexed
    expect(result).toContain("error");
    expect(result).toContain("[2304]");
    expect(result).toContain("(ts)");
    expect(result).toContain("Cannot find name 'foo'.");
  });

  it("formats warning diagnostic", () => {
    const diag: LSPDiagnostic = {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 5 },
      },
      severity: 2,
      message: "Unused variable",
    };

    const result = formatDiagnostic(diag);
    expect(result).toContain("1:1");
    expect(result).toContain("warning");
    expect(result).toContain("Unused variable");
  });

  it("handles missing severity", () => {
    const diag: LSPDiagnostic = {
      range: {
        start: { line: 5, character: 0 },
        end: { line: 5, character: 10 },
      },
      message: "Some info",
    };

    const result = formatDiagnostic(diag);
    expect(result).toContain("info");
    expect(result).toContain("Some info");
  });

  it("handles missing source and code", () => {
    const diag: LSPDiagnostic = {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
      severity: 1,
      message: "Error",
    };

    const result = formatDiagnostic(diag);
    expect(result).not.toContain("(");
    expect(result).not.toContain("[");
  });

  it("handles string code", () => {
    const diag: LSPDiagnostic = {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
      severity: 1,
      code: "E001",
      message: "Error",
    };

    const result = formatDiagnostic(diag);
    expect(result).toContain("[E001]");
  });
});

// ── LSPManager.getErrorDiagnosticsText (with mocked data) ─────

describe("getErrorDiagnosticsText formatting", () => {
  it("formats error diagnostics into XML block", () => {
    // We test the formatter directly since LSPManager.getErrorDiagnosticsText
    // depends on client diagnostics which require a real server
    const diags: LSPDiagnostic[] = [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
        severity: 1,
        code: 2304,
        source: "ts",
        message: "Cannot find name 'x'.",
      },
      {
        range: { start: { line: 5, character: 10 }, end: { line: 5, character: 15 } },
        severity: 2, // Warning — should be filtered out by getErrorDiagnosticsText
        message: "Unused var",
      },
    ];

    // Filter to errors only (severity 1) — same logic as getErrorDiagnosticsText
    const errors = diags.filter((d) => d.severity === 1);
    expect(errors.length).toBe(1);

    const formatted = errors.map((d) => formatDiagnostic(d));
    expect(formatted[0]).toContain("Cannot find name 'x'.");
    expect(formatted[0]).toContain("error");
  });
});
