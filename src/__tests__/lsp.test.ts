import { describe, expect, it } from "vitest";
import {
  DiagSeverity,
  LSPClient,
  LSPManager,
  findServersForExtension,
  formatDiagnostic,
  getLanguageId,
} from "../lsp/index.js";

describe("lsp helpers", () => {
  it("maps common file extensions to language ids and built-in servers", () => {
    expect(getLanguageId(".TS")).toBe("typescript");
    expect(getLanguageId(".tsx")).toBe("typescriptreact");
    expect(getLanguageId(".py")).toBe("python");
    expect(getLanguageId(".unknown")).toBeUndefined();

    expect(findServersForExtension(".TS").map((server) => server.id)).toEqual(["typescript"]);
    expect(findServersForExtension(".go").map((server) => server.id)).toEqual(["gopls"]);
    expect(findServersForExtension(".unknown")).toEqual([]);
  });

  it("formats diagnostics with severity, source, and code", () => {
    expect(formatDiagnostic({
      range: {
        start: { line: 4, character: 2 },
        end: { line: 4, character: 10 },
      },
      severity: DiagSeverity.Error,
      source: "ts",
      code: 2322,
      message: "Type mismatch",
    })).toBe("  5:3 error [2322] (ts): Type mismatch");

    expect(formatDiagnostic({
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
      message: "FYI",
    })).toBe("  1:1 info: FYI");
  });

  it("returns safe defaults while disabled or disconnected", async () => {
    const manager = new LSPManager(process.cwd());
    manager.disable();

    await manager.touchFile("src/index.ts", true);
    await expect(manager.getDefinition("src/index.ts", 0, 0)).resolves.toEqual([]);
    await expect(manager.getReferences("src/index.ts", 0, 0)).resolves.toEqual([]);
    await expect(manager.getDocumentSymbols("src/index.ts")).resolves.toEqual([]);
    await expect(manager.getHover("src/index.ts", 0, 0)).resolves.toBeNull();
    await expect(manager.getCompletions("src/index.ts", 0, 0)).resolves.toEqual([]);
    expect(manager.getDiagnostics("src/index.ts")).toEqual([]);
    expect(manager.getErrorDiagnosticsText("src/index.ts")).toBe("");
    expect(manager.getClientInfos()).toEqual([]);
    expect(manager.isBroken("typescript")).toBe(false);

    const client = new LSPClient({
      id: "test",
      extensions: [".test"],
      command: "test-lsp",
      args: ["--stdio"],
      languageId: "test",
    }, process.cwd());

    await client.touchFile("missing.test", true);
    await expect(client.getDefinition("missing.test", 0, 0)).resolves.toEqual([]);
    await expect(client.getReferences("missing.test", 0, 0)).resolves.toEqual([]);
    await expect(client.getDocumentSymbols("missing.test")).resolves.toEqual([]);
    await expect(client.getHover("missing.test", 0, 0)).resolves.toBeNull();
    await expect(client.getCompletions("missing.test", 0, 0)).resolves.toEqual([]);
    expect(client.getDiagnostics("missing.test")).toEqual([]);
    expect(client.getAllDiagnostics().size).toBe(0);
    expect(client.getState()).toBe("disconnected");
    expect(client.getInfo()).toMatchObject({
      serverId: "test",
      state: "disconnected",
      rootDir: process.cwd(),
    });
    expect(client.getServerId()).toBe("test");
    client.stop();
    expect(client.getState()).toBe("disconnected");
  });
});
