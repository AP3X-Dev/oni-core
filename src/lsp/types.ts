/**
 * LSP Protocol Types — minimal subset for diagnostics-only client.
 *
 * Based on the Language Server Protocol specification.
 * Only includes types needed for: initialize, didOpen, didChange,
 * publishDiagnostics. Extended later for symbols, hover, etc.
 */

// ── Position & Range ─────────────────────────────────────────

export interface LSPPosition {
  line: number;
  character: number;
}

export interface LSPRange {
  start: LSPPosition;
  end: LSPPosition;
}

// ── Diagnostics ──────────────────────────────────────────────

export enum DiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4,
}

export interface LSPDiagnostic {
  range: LSPRange;
  severity?: DiagnosticSeverity;
  code?: number | string;
  source?: string;
  message: string;
}

export interface PublishDiagnosticsParams {
  uri: string;
  version?: number;
  diagnostics: LSPDiagnostic[];
}

// ── Location ────────────────────────────────────────────────

export interface LSPLocation {
  uri: string;
  range: LSPRange;
}

// ── Document Symbols ────────────────────────────────────────

export interface LSPDocumentSymbol {
  name: string;
  kind: number;
  range: LSPRange;
  selectionRange: LSPRange;
  children?: LSPDocumentSymbol[];
}

// ── Hover ───────────────────────────────────────────────────

export interface LSPHover {
  contents: string | { kind: string; value: string };
  range?: LSPRange;
}

// ── Completion ──────────────────────────────────────────────

export interface LSPCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  insertText?: string;
}

// ── TextDocumentPositionParams ───────────────────────────────

export interface TextDocumentPositionParams {
  textDocument: { uri: string };
  position: LSPPosition;
}

// ── Initialize ───────────────────────────────────────────────

export interface InitializeParams {
  processId: number | null;
  rootUri: string | null;
  capabilities: ClientCapabilities;
  workspaceFolders?: Array<{ uri: string; name: string }> | null;
  initializationOptions?: unknown;
}

export interface ClientCapabilities {
  textDocument?: {
    synchronization?: {
      didOpen?: boolean;
      didChange?: boolean;
    };
    publishDiagnostics?: {
      versionSupport?: boolean;
    };
    definition?: { dynamicRegistration?: boolean };
    references?: { dynamicRegistration?: boolean };
    documentSymbol?: { dynamicRegistration?: boolean };
    hover?: { contentFormat?: string[] };
    completion?: { dynamicRegistration?: boolean };
  };
  window?: {
    workDoneProgress?: boolean;
  };
  workspace?: {
    configuration?: boolean;
    workspaceFolders?: {
      supported?: boolean;
    };
  };
}

export interface InitializeResult {
  capabilities: ServerCapabilities;
  serverInfo?: { name: string; version?: string };
}

export interface ServerCapabilities {
  textDocumentSync?: number | { openClose?: boolean; change?: number };
  diagnosticProvider?: unknown;
  [key: string]: unknown;
}

// ── Text Document ────────────────────────────────────────────

export interface TextDocumentItem {
  uri: string;
  languageId: string;
  version: number;
  text: string;
}

export interface DidOpenTextDocumentParams {
  textDocument: TextDocumentItem;
}

export interface DidChangeTextDocumentParams {
  textDocument: { uri: string; version: number };
  contentChanges: Array<{ text: string }>;
}

// ── Server Configuration ─────────────────────────────────────

export interface LSPServerConfig {
  /** Server identifier (e.g., "typescript", "pyright") */
  id: string;
  /** File extensions this server handles */
  extensions: string[];
  /** Spawn command */
  command: string;
  /** Command arguments */
  args?: string[];
  /** Language ID for documents */
  languageId: string;
  /** Extra environment variables passed to the spawned server process */
  env?: Record<string, string>;
  /** Initialization options passed to the server */
  initializationOptions?: unknown;
}

// ── Client State ─────────────────────────────────────────────

export type LSPClientState = "disconnected" | "connecting" | "ready" | "error" | "broken";

export interface LSPClientInfo {
  serverId: string;
  state: LSPClientState;
  rootDir: string;
  serverInfo?: { name: string; version?: string };
}

// ── JSON-RPC (reused from MCP but local to avoid cross-module dep) ──

export interface JsonRpcMessage {
  jsonrpc: "2.0";
}

export interface JsonRpcRequest extends JsonRpcMessage {
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse extends JsonRpcMessage {
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification extends JsonRpcMessage {
  method: string;
  params?: unknown;
}
