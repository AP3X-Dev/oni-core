/**
 * LSP Client — Language Server Protocol client over stdio.
 *
 * Manages a single language server connection:
 * - Spawn process with Content-Length framed JSON-RPC
 * - Initialize handshake (capabilities, rootUri)
 * - Track open files with version numbers
 * - Receive and cache diagnostics per file
 * - touchFile() → open/change → await diagnostics
 *
 * Swarm-aware: A single LSPClient instance is shared across all agents.
 * Concurrent touchFile() calls are safe — file versions are tracked atomically.
 *
 * Zero-dependency: uses only node:child_process and node:path.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { validateSpawnCommand } from "../internal/validate-command.js";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import type {
  LSPServerConfig,
  LSPClientState,
  LSPClientInfo,
  LSPDiagnostic,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  InitializeResult,
  PublishDiagnosticsParams,
} from "./types.js";

// ── Constants ────────────────────────────────────────────────

const INITIALIZE_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
const DIAGNOSTICS_DEBOUNCE_MS = 150;
const DIAGNOSTICS_TIMEOUT_MS = 3_000;
const MAX_TRACKED_FILES = 2_000;

// ── Pending Request ──────────────────────────────────────────

interface PendingRequest {
  resolve: (value: JsonRpcResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ── Diagnostics Waiter ───────────────────────────────────────

interface DiagnosticsWaiter {
  resolve: () => void;
  debounceTimer?: ReturnType<typeof setTimeout>;
  overallTimer: ReturnType<typeof setTimeout>;
}

// ── LSPClient ────────────────────────────────────────────────

export class LSPClient {
  private readonly config: LSPServerConfig;
  private readonly rootDir: string;

  private process: ChildProcess | null = null;
  private state: LSPClientState = "disconnected";
  private serverInfo?: { name: string; version?: string };

  // JSON-RPC
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private buffer = Buffer.alloc(0);

  // File tracking
  private fileVersions = new Map<string, number>();

  // Diagnostics
  private diagnosticsCache = new Map<string, LSPDiagnostic[]>();
  private diagnosticsWaiters = new Map<string, DiagnosticsWaiter[]>();

  // Coalescing lock — concurrent start() callers share one in-flight Promise
  private _startPromise: Promise<void> | null = null;

  // Stored listener reference for clean removal in stop()
  private _onStdoutData: ((chunk: Buffer) => void) | null = null;

  constructor(config: LSPServerConfig, rootDir: string) {
    this.config = config;
    this.rootDir = rootDir;
  }

  // ── Lifecycle ────────────────────────────────────────────

  /**
   * Start the language server and complete the initialize handshake.
   */
  async start(): Promise<void> {
    if (this.state === "ready") return;
    if (this.state === "broken") {
      throw new Error(`LSP server "${this.config.id}" is marked as broken`);
    }
    // Coalescing lock: if a start is already in progress, join it instead of
    // spawning a second language server process.
    if (this._startPromise) return this._startPromise;

    this._startPromise = this._doStart().finally(() => {
      this._startPromise = null;
    });
    return this._startPromise;
  }

  private async _doStart(): Promise<void> {
    this.state = "connecting";

    // Build a minimal base environment — only essential system variables
    // are forwarded so secrets (API keys, tokens) from the parent process
    // are never leaked to LSP server child processes.  Explicitly
    // configured env vars (this.config.env) are merged on top.
    const BASE_ENV: Record<string, string> = {};
    for (const k of ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "LANG", "TERM"]) {
      if (process.env[k]) BASE_ENV[k] = process.env[k]!;
    }

    try {
      validateSpawnCommand(this.config.command, `LSP server "${this.config.id}"`);
      this.process = spawn(this.config.command, this.config.args ?? [], {
        cwd: this.rootDir,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...BASE_ENV, ...this.config.env },
        shell: false,
      });

      // Wire up stdout for JSON-RPC responses (Buffer-based)
      this._onStdoutData = (chunk: Buffer) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this.processBuffer();
      };
      this.process.stdout?.on("data", this._onStdoutData);

      // Ignore stderr (server logs)
      this.process.stderr?.on("data", () => {});

      // Handle process exit
      this.process.on("exit", () => {
        this.handleProcessExit();
      });

      this.process.on("error", (err) => {
        this.state = "broken";
        this.rejectAllPending(`LSP server process error: ${err.message}`);
        this.clearAllWaiters();
        this.process = null;
      });

      // Send initialize request
      const rootUri = pathToFileURL(this.rootDir).toString();
      const result = await this.sendRequest("initialize", {
        processId: this.process.pid ?? null,
        rootUri,
        capabilities: {
          textDocument: {
            synchronization: {
              didOpen: true,
              didChange: true,
            },
            publishDiagnostics: {
              versionSupport: true,
            },
          },
          window: {
            workDoneProgress: true,
          },
        },
        workspaceFolders: [
          { uri: rootUri, name: this.rootDir.split("/").pop() ?? "workspace" },
        ],
        initializationOptions: this.config.initializationOptions,
      }, INITIALIZE_TIMEOUT_MS);

      if (result.error) {
        throw new Error(`Initialize failed: ${result.error.message}`);
      }

      const initResult = result.result as InitializeResult;
      this.serverInfo = initResult.serverInfo;

      // Send initialized notification
      this.sendNotification("initialized", {});

      this.state = "ready";
    } catch (err) {
      // Capture state BEFORE stop() — stop() always overwrites to "disconnected".
      // If an external stop() already ran during the async connect (e.g. during
      // sendRequest("initialize")), it would have set state to "disconnected"
      // before this catch fires. In that case keep it "disconnected" so the
      // client remains restartable. Assigned to `string` to escape TypeScript's
      // control-flow narrowing, which does not model concurrent async mutations.
      const stateAtCatch: string = this.state;
      this.stop();
      if (stateAtCatch !== "disconnected") {
        this.state = "broken";
      }
      throw err;
    }
  }

  /**
   * Stop the language server.
   */
  stop(): void {
    this.rejectAllPending("LSP client stopping");
    this.clearAllWaiters();

    if (this.process) {
      // Remove the stdout data listener before killing to prevent the closure
      // (which captures `this`) from preventing GC of the LSPClient instance.
      if (this._onStdoutData) {
        this.process.stdout?.removeListener("data", this._onStdoutData);
        this._onStdoutData = null;
      }
      this.process.stdout?.removeAllListeners("data");
      this.process.stderr?.removeAllListeners("data");
      this.process.removeAllListeners("exit");
      this.process.removeAllListeners("error");
      try {
        this.process.kill();
      } catch {
        // Already dead
      }
      this.process = null;
    }

    this.state = "disconnected";
    this.fileVersions.clear();
    this.diagnosticsCache.clear();
  }

  // ── File Operations ──────────────────────────────────────

  /**
   * Notify the server about a file change and optionally wait for diagnostics.
   *
   * If the file hasn't been opened yet, sends didOpen. Otherwise sends didChange.
   * Reads the file content from disk.
   */
  async touchFile(
    filePath: string,
    waitForDiagnostics = false,
  ): Promise<void> {
    if (this.state !== "ready") return;

    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      return; // File doesn't exist or unreadable
    }

    const uri = pathToFileURL(filePath).toString();
    const version = this.fileVersions.get(filePath);

    // Set up diagnostics waiter before sending notification
    const waiterPromise = waitForDiagnostics
      ? this.waitForDiagnostics(filePath)
      : undefined;

    if (version === undefined) {
      // First time — didOpen; evict oldest entry if at cap
      if (this.fileVersions.size >= MAX_TRACKED_FILES) {
        const oldest = this.fileVersions.keys().next().value as string;
        this.fileVersions.delete(oldest);
      }
      this.fileVersions.set(filePath, 0);
      this.sendNotification("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId: this.config.languageId,
          version: 0,
          text: content,
        },
      });
    } else {
      // Subsequent — didChange (re-read to prevent stale version from concurrent callers)
      const nextVersion = (this.fileVersions.get(filePath) ?? 0) + 1;
      this.fileVersions.set(filePath, nextVersion);
      this.sendNotification("textDocument/didChange", {
        textDocument: { uri, version: nextVersion },
        contentChanges: [{ text: content }],
      });
    }

    // Optionally wait for diagnostics
    if (waiterPromise) {
      await waiterPromise;
    }
  }

  /**
   * Get cached diagnostics for a file.
   */
  getDiagnostics(filePath: string): LSPDiagnostic[] {
    return this.diagnosticsCache.get(filePath) ?? [];
  }

  /**
   * Get all cached diagnostics keyed by file path.
   */
  getAllDiagnostics(): Map<string, LSPDiagnostic[]> {
    return new Map(this.diagnosticsCache);
  }

  // ── State Queries ────────────────────────────────────────

  getState(): LSPClientState {
    return this.state;
  }

  getInfo(): LSPClientInfo {
    return {
      serverId: this.config.id,
      state: this.state,
      rootDir: this.rootDir,
      serverInfo: this.serverInfo,
    };
  }

  getServerId(): string {
    return this.config.id;
  }

  // ── Diagnostics Waiter ───────────────────────────────────

  private waitForDiagnostics(filePath: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const overallTimer = setTimeout(() => {
        this.removeWaiter(filePath, waiter);
        resolve(); // Swallow timeout — diagnostics are best-effort
      }, DIAGNOSTICS_TIMEOUT_MS);

      const waiter: DiagnosticsWaiter = {
        resolve: () => {
          clearTimeout(overallTimer);
          if (waiter.debounceTimer) clearTimeout(waiter.debounceTimer);
          this.removeWaiter(filePath, waiter);
          resolve();
        },
        overallTimer,
      };

      const existing = this.diagnosticsWaiters.get(filePath) ?? [];
      existing.push(waiter);
      this.diagnosticsWaiters.set(filePath, existing);
    });
  }

  private notifyDiagnosticsWaiters(filePath: string): void {
    const waiters = this.diagnosticsWaiters.get(filePath);
    if (!waiters || waiters.length === 0) return;

    for (const waiter of waiters) {
      // Debounce: wait 150ms for follow-up diagnostics
      if (waiter.debounceTimer) clearTimeout(waiter.debounceTimer);
      waiter.debounceTimer = setTimeout(() => {
        waiter.resolve();
      }, DIAGNOSTICS_DEBOUNCE_MS);
    }
  }

  private removeWaiter(filePath: string, waiter: DiagnosticsWaiter): void {
    const waiters = this.diagnosticsWaiters.get(filePath);
    if (!waiters) return;
    const idx = waiters.indexOf(waiter);
    if (idx >= 0) waiters.splice(idx, 1);
    if (waiters.length === 0) this.diagnosticsWaiters.delete(filePath);
  }

  private clearAllWaiters(): void {
    for (const [, waiters] of this.diagnosticsWaiters) {
      for (const w of waiters) {
        clearTimeout(w.overallTimer);
        if (w.debounceTimer) clearTimeout(w.debounceTimer);
        w.resolve();
      }
    }
    this.diagnosticsWaiters.clear();
  }

  // ── JSON-RPC Transport ───────────────────────────────────

  private sendRequest(
    method: string,
    params?: unknown,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error("LSP process not connected"));
        return;
      }

      const id = this.nextId++;
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.writeMessage(request as unknown as Record<string, unknown>);
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    if (!this.process?.stdin?.writable) return;

    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      params,
    };

    this.writeMessage(notification as unknown as Record<string, unknown>);
  }

  private writeMessage(message: Record<string, unknown>): void {
    const json = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`;
    try {
      this.process?.stdin?.write(header + json);
    } catch {
      // Process may have died
    }
  }

  private static readonly MAX_BUFFER_SIZE = 64 * 1024 * 1024; // 64 MB

  private processBuffer(): void {
    if (this.buffer.length > LSPClient.MAX_BUFFER_SIZE) {
      console.error("[lsp] Buffer exceeded 64 MB limit — disconnecting");
      this.buffer = Buffer.alloc(0);
      this.stop();
      return;
    }

    while (true) {
      // Look for Content-Length header (byte-level search)
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const header = this.buffer.subarray(0, headerEnd).toString("utf-8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        // Malformed header — skip to next potential header
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }

      // contentLength is a byte count (per LSP wire spec)
      const contentLength = parseInt(match[1]!, 10);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;

      if (this.buffer.length < bodyEnd) break; // Incomplete body

      // Decode body bytes to string only after correct byte-level slicing
      const body = this.buffer.subarray(bodyStart, bodyEnd).toString("utf-8");
      this.buffer = this.buffer.subarray(bodyEnd);

      try {
        const message = JSON.parse(body);
        this.handleMessage(message);
      } catch {
        // Malformed JSON — skip
      }
    }
  }

  private handleMessage(message: Record<string, unknown>): void {
    // Server → client request (has id + method, needs response) — must be
    // checked BEFORE the response branch because requests also have a non-null
    // id; the response branch would otherwise capture them and return early.
    if ("id" in message && "method" in message) {
      const method = message.method as string;
      // Handle common server requests with empty responses
      if (
        method === "window/workDoneProgress/create" ||
        method === "client/registerCapability" ||
        method === "client/unregisterCapability"
      ) {
        this.writeMessage({
          jsonrpc: "2.0",
          id: message.id,
          result: null,
        });
      } else if (method === "workspace/configuration") {
        // Return initialization options for each requested item
        const items = ((message.params as Record<string, unknown>)?.items as unknown[]) ?? [];
        this.writeMessage({
          jsonrpc: "2.0",
          id: message.id,
          result: items.map(() => this.config.initializationOptions ?? {}),
        });
      } else {
        // LSP spec requires a response to every server-initiated request.
        // Reply with MethodNotFound so the server is not left waiting.
        this.writeMessage({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: `Method not supported: ${method}` },
        });
      }
      return;
    }

    // Response (has id but no method)
    if ("id" in message && message.id !== null) {
      if (typeof message.id === "undefined") {
        console.warn("[lsp] Malformed response: missing id");
        return;
      }
      const id = message.id as number;
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.resolve(message as unknown as JsonRpcResponse);
      }
      return;
    }

    // Notification (no id)
    if ("method" in message) {
      if (typeof message.method !== "string") {
        console.warn("[lsp] Malformed notification: missing method");
        return;
      }
      this.handleNotification(message as unknown as JsonRpcNotification);
    }
  }

  private handleNotification(notification: JsonRpcNotification): void {
    if (notification.method === "textDocument/publishDiagnostics") {
      const params = notification.params as PublishDiagnosticsParams;
      const filePath = this.uriToPath(params.uri);
      if (
        !this.diagnosticsCache.has(filePath) &&
        this.diagnosticsCache.size >= MAX_TRACKED_FILES
      ) {
        const oldest = this.diagnosticsCache.keys().next().value as string;
        this.diagnosticsCache.delete(oldest);
      }
      this.diagnosticsCache.set(filePath, params.diagnostics);
      this.notifyDiagnosticsWaiters(filePath);
    }
    // Other notifications silently ignored
  }

  // ── Helpers ──────────────────────────────────────────────

  private uriToPath(uri: string): string {
    // file:///C:/foo/bar.ts → C:/foo/bar.ts (Windows)
    // file:///home/user/bar.ts → /home/user/bar.ts (Unix)
    try {
      const url = new URL(uri);
      if (url.protocol === "file:") {
        // On Windows, pathname starts with / before drive letter
        let p = decodeURIComponent(url.pathname);
        if (process.platform === "win32" && p.startsWith("/") && /^\/[A-Za-z]:/.test(p)) {
          p = p.slice(1);
        }
        return p;
      }
    } catch {
      // Not a valid URL
    }
    return uri;
  }

  private handleProcessExit(): void {
    if (this.state === "ready" || this.state === "connecting") {
      this.state = "broken";
    }
    this.rejectAllPending("LSP server exited");
    this.clearAllWaiters();
    this.process = null;
  }

  private rejectAllPending(reason: string): void {
    for (const [_id, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(new Error(reason));
    }
    this.pending.clear();
  }
}
