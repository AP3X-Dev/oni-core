/**
 * MCP Transport — JSON-RPC over stdio with Content-Length framing.
 *
 * Implements the standard LSP/MCP wire protocol:
 *   Content-Length: <N>\r\n\r\n<JSON payload>
 *
 * The transport handles:
 * - Spawning a child process
 * - Framing outbound JSON-RPC messages
 * - Parsing inbound Content-Length framed responses
 * - Routing responses to pending request promises
 * - Forwarding notifications to a handler
 */

import { spawn, type ChildProcess } from "node:child_process";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
} from "./types.js";

// ── Types ─────────────────────────────────────────────────────

export type NotificationHandler = (notification: JsonRpcNotification) => void;

export interface StdioTransportConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  onNotification?: NotificationHandler;
  /** Timeout for spawning the process (ms, default: 10000) */
  spawnTimeout?: number;
}

interface PendingRequest {
  resolve: (value: JsonRpcResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ── StdioTransport ────────────────────────────────────────────

export class StdioTransport {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private buffer = "";
  private onNotification: NotificationHandler;
  private connected = false;

  constructor(private config: StdioTransportConfig) {
    this.onNotification = config.onNotification ?? (() => {});
  }

  // ── Lifecycle ───────────────────────────────────────────────

  /**
   * Spawn the child process and start reading stdout.
   * Throws if the process fails to spawn within the timeout.
   */
  async start(): Promise<void> {
    if (this.connected) return;

    const timeout = this.config.spawnTimeout ?? 10_000;

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.stop();
        reject(new Error(`MCP server failed to start within ${timeout}ms`));
      }, timeout);

      try {
        this.process = spawn(this.config.command, this.config.args ?? [], {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, ...this.config.env },
          cwd: this.config.cwd,
          shell: false,
        });
      } catch (err) {
        clearTimeout(timer);
        reject(
          new Error(
            `Failed to spawn MCP server: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        return;
      }

      this.process.on("error", (err) => {
        clearTimeout(timer);
        this.connected = false;
        reject(new Error(`MCP server process error: ${err.message}`));
      });

      this.process.on("exit", (code) => {
        this.connected = false;
        // Reject all pending requests
        for (const [id, req] of this.pending) {
          req.reject(new Error(`MCP server exited with code ${code}`));
          clearTimeout(req.timer);
          this.pending.delete(id);
        }
      });

      if (this.process.stdout) {
        this.process.stdout.on("data", (chunk: Buffer) => {
          this.buffer += chunk.toString("utf-8");
          this.processBuffer();
        });
      }

      // Process spawned successfully — consider it started
      // (actual MCP readiness is confirmed by the initialize handshake)
      this.connected = true;
      clearTimeout(timer);
      resolve();
    });
  }

  /**
   * Stop the transport and kill the child process.
   */
  stop(): void {
    this.connected = false;

    // Clear all pending requests
    for (const [id, req] of this.pending) {
      req.reject(new Error("MCP transport stopped"));
      clearTimeout(req.timer);
      this.pending.delete(id);
    }

    if (this.process) {
      try {
        this.process.kill("SIGTERM");
      } catch {
        // Process may have already exited
      }
      this.process = null;
    }

    this.buffer = "";
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ── Send ────────────────────────────────────────────────────

  /**
   * Send a JSON-RPC request and wait for the response.
   * Times out after `timeoutMs` (default: 30s).
   */
  async send(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = 30_000,
  ): Promise<JsonRpcResponse> {
    if (!this.connected || !this.process?.stdin) {
      throw new Error("MCP transport not connected");
    }

    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    };

    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      const payload = JSON.stringify(request);
      const frame = `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`;

      this.process!.stdin!.write(frame, (err) => {
        if (err) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(new Error(`Failed to write to MCP server: ${err.message}`));
        }
      });
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   */
  notify(method: string, params?: Record<string, unknown>): void {
    if (!this.connected || !this.process?.stdin) return;

    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      ...(params !== undefined ? { params } : {}),
    };

    const payload = JSON.stringify(notification);
    const frame = `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`;
    this.process.stdin.write(frame);
  }

  // ── Buffer processing ───────────────────────────────────────

  private processBuffer(): void {
    while (true) {
      // Look for Content-Length header
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const header = this.buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        // Invalid header — skip to next potential header
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1]!, 10);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;

      if (this.buffer.length < bodyEnd) {
        // Not enough data yet — wait for more
        break;
      }

      const body = this.buffer.slice(bodyStart, bodyEnd);
      this.buffer = this.buffer.slice(bodyEnd);

      try {
        const message = JSON.parse(body) as Record<string, unknown>;
        this.handleMessage(message);
      } catch {
        // Malformed JSON — skip
      }
    }
  }

  private handleMessage(message: Record<string, unknown>): void {
    // Response (has id)
    if ("id" in message && typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        pending.resolve(message as unknown as JsonRpcResponse);
      }
      return;
    }

    // Notification (no id, has method)
    if ("method" in message && typeof message.method === "string") {
      this.onNotification(message as unknown as JsonRpcNotification);
    }
  }
}
