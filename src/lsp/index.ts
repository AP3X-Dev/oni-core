/**
 * LSP Module — Language Server Protocol integration.
 *
 * High-level facade for managing LSP clients:
 * - Auto-spawns appropriate language server for each file type
 * - Caches broken servers to avoid repeated spawn attempts
 * - Provides touchFile() → diagnostics() flow for edit tools
 * - Single instance shared across all swarm agents (concurrent-safe)
 *
 * Usage:
 *   const lsp = new LSPManager(rootDir);
 *   await lsp.touchFile("src/index.ts", true); // true = wait for diagnostics
 *   const diags = lsp.getDiagnostics("src/index.ts");
 *
 * Swarm-aware: Multiple agents can call touchFile() concurrently.
 * File versions are tracked per-file, not per-agent.
 */

import { extname } from "node:path";
import { LSPClient } from "./client.js";
import { findServersForExtension, getLanguageId } from "./servers.js";
import type { LSPServerConfig, LSPDiagnostic, LSPClientInfo, DiagnosticSeverity } from "./types.js";

export { LSPClient } from "./client.js";
export {
  BUILTIN_SERVERS,
  TYPESCRIPT_SERVER,
  PYRIGHT_SERVER,
  GOPLS_SERVER,
  RUST_ANALYZER_SERVER,
  findServersForExtension,
  getLanguageId,
  LANGUAGE_MAP,
} from "./servers.js";
export type {
  LSPServerConfig,
  LSPDiagnostic,
  LSPClientState,
  LSPClientInfo,
  LSPPosition,
  LSPRange,
  DiagnosticSeverity,
  InitializeResult,
  ServerCapabilities,
  PublishDiagnosticsParams,
} from "./types.js";
export { DiagnosticSeverity as DiagSeverity } from "./types.js";

// ── Constants ────────────────────────────────────────────────

const MAX_DIAGNOSTICS_PER_FILE = 20;

// ── LSPManager ───────────────────────────────────────────────

export class LSPManager {
  private readonly rootDir: string;
  private readonly clients = new Map<string, LSPClient>();
  private readonly broken = new Set<string>();
  private readonly spawning = new Map<string, Promise<LSPClient | null>>();
  private customServers: LSPServerConfig[] = [];
  private disabled = false;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  // ── Configuration ────────────────────────────────────────

  /**
   * Add custom server configurations (from config file).
   */
  addServers(servers: LSPServerConfig[]): void {
    this.customServers.push(...servers);
  }

  /**
   * Disable LSP entirely (e.g., from config: `lsp: false`).
   */
  disable(): void {
    this.disabled = true;
    this.disposeAll();
  }

  // ── Core Operations ──────────────────────────────────────

  /**
   * Touch a file — notify appropriate LSP servers and optionally
   * wait for diagnostics.
   *
   * Lazily spawns servers on first call for each file type.
   * Skips broken servers silently.
   */
  async touchFile(filePath: string, waitForDiagnostics = false): Promise<void> {
    if (this.disabled) return;

    const clients = await this.getClientsForFile(filePath);
    if (clients.length === 0) return;

    await Promise.all(
      clients.map((client) =>
        client.touchFile(filePath, waitForDiagnostics).catch(() => {
          // Swallow individual client errors
        }),
      ),
    );
  }

  /**
   * Get diagnostics for a specific file across all active servers.
   */
  getDiagnostics(filePath: string): LSPDiagnostic[] {
    const allDiags: LSPDiagnostic[] = [];
    for (const client of this.clients.values()) {
      allDiags.push(...client.getDiagnostics(filePath));
    }
    return allDiags;
  }

  /**
   * Get error-level diagnostics for a file, formatted for tool output.
   *
   * Returns a string suitable for appending to edit_file results,
   * or empty string if no errors.
   */
  getErrorDiagnosticsText(filePath: string): string {
    const diags = this.getDiagnostics(filePath);
    const errors = diags.filter((d) => d.severity === 1); // DiagnosticSeverity.Error

    if (errors.length === 0) return "";

    const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE);
    const lines = limited.map((d) => formatDiagnostic(d));

    return `\n\nLSP errors detected:\n<diagnostics file="${filePath}">\n${lines.join("\n")}\n</diagnostics>`;
  }

  // ── State Queries ────────────────────────────────────────

  /**
   * Get info about all active clients.
   */
  getClientInfos(): LSPClientInfo[] {
    return [...this.clients.values()].map((c) => c.getInfo());
  }

  /**
   * Check if a server is marked as broken.
   */
  isBroken(serverId: string): boolean {
    return this.broken.has(serverId);
  }

  // ── Lifecycle ────────────────────────────────────────────

  /**
   * Dispose all clients and clear state.
   */
  disposeAll(): void {
    for (const client of this.clients.values()) {
      client.stop();
    }
    this.clients.clear();
    this.spawning.clear();
    // Don't clear broken — those stay until session restart
  }

  // ── Internal: Client Resolution ──────────────────────────

  private async getClientsForFile(filePath: string): Promise<LSPClient[]> {
    const ext = extname(filePath);
    if (!ext) return [];

    // Find servers from built-in + custom
    const builtinServers = findServersForExtension(ext);
    const customServers = this.customServers.filter((s) =>
      s.extensions.includes(ext.toLowerCase()),
    );
    const allServers = [...builtinServers, ...customServers];

    const result: LSPClient[] = [];

    for (const server of allServers) {
      const key = `${this.rootDir}:${server.id}`;

      // Skip broken servers
      if (this.broken.has(key)) continue;

      // Return existing client
      const existing = this.clients.get(key);
      if (existing && existing.getState() === "ready") {
        result.push(existing);
        continue;
      }

      // Check if already spawning (dedup)
      const inflight = this.spawning.get(key);
      if (inflight) {
        const client = await inflight;
        if (client) result.push(client);
        continue;
      }

      // Spawn new client
      const spawnTask = this.spawnClient(server, key);
      this.spawning.set(key, spawnTask);

      const client = await spawnTask;
      this.spawning.delete(key);

      if (client) result.push(client);
    }

    return result;
  }

  private async spawnClient(
    config: LSPServerConfig,
    key: string,
  ): Promise<LSPClient | null> {
    const client = new LSPClient(config, this.rootDir);

    try {
      await client.start();
      this.clients.set(key, client);
      return client;
    } catch {
      // Mark as broken — don't retry until session restart
      this.broken.add(key);
      return null;
    }
  }
}

// ── Formatting ───────────────────────────────────────────────

/**
 * Format a diagnostic for human-readable output.
 */
export function formatDiagnostic(d: LSPDiagnostic): string {
  const severity = d.severity === 1 ? "error" : d.severity === 2 ? "warning" : "info";
  const loc = `${d.range.start.line + 1}:${d.range.start.character + 1}`;
  const source = d.source ? ` (${d.source})` : "";
  const code = d.code !== undefined ? ` [${d.code}]` : "";
  return `  ${loc} ${severity}${code}${source}: ${d.message}`;
}
