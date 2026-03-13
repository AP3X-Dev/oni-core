/**
 * LSP Server Configurations — built-in language server definitions.
 *
 * Each server maps file extensions to a language server command.
 * Servers are lazily spawned on first touchFile() for a matching extension.
 *
 * Start with TypeScript (most common for this codebase). Add more later:
 * pyright, gopls, rust-analyzer, etc.
 */

import type { LSPServerConfig } from "./types.js";

// ── Extension → Language ID Map ──────────────────────────────

export const LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".rb": "ruby",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".swift": "swift",
  ".kt": "kotlin",
  ".lua": "lua",
  ".zig": "zig",
  ".ex": "elixir",
  ".exs": "elixir",
};

/**
 * Get the language ID for a file extension.
 * Returns undefined if the extension isn't recognized.
 */
export function getLanguageId(ext: string): string | undefined {
  return LANGUAGE_MAP[ext.toLowerCase()];
}

// ── Built-in Server Configs ──────────────────────────────────

/**
 * TypeScript language server via typescript-language-server.
 *
 * Requires: `typescript-language-server` in PATH or node_modules/.bin
 * Falls back to: `npx typescript-language-server --stdio`
 */
export const TYPESCRIPT_SERVER: LSPServerConfig = {
  id: "typescript",
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
  command: "typescript-language-server",
  args: ["--stdio"],
  languageId: "typescript",
};

/**
 * Pyright language server for Python.
 *
 * Requires: `pyright-langserver` in PATH
 */
export const PYRIGHT_SERVER: LSPServerConfig = {
  id: "pyright",
  extensions: [".py"],
  command: "pyright-langserver",
  args: ["--stdio"],
  languageId: "python",
};

/**
 * gopls language server for Go.
 *
 * Requires: `gopls` in PATH
 */
export const GOPLS_SERVER: LSPServerConfig = {
  id: "gopls",
  extensions: [".go"],
  command: "gopls",
  args: ["serve"],
  languageId: "go",
};

/**
 * rust-analyzer for Rust.
 *
 * Requires: `rust-analyzer` in PATH
 */
export const RUST_ANALYZER_SERVER: LSPServerConfig = {
  id: "rust-analyzer",
  extensions: [".rs"],
  command: "rust-analyzer",
  args: [],
  languageId: "rust",
};

// ── All Built-in Servers ─────────────────────────────────────

export const BUILTIN_SERVERS: LSPServerConfig[] = [
  TYPESCRIPT_SERVER,
  PYRIGHT_SERVER,
  GOPLS_SERVER,
  RUST_ANALYZER_SERVER,
];

/**
 * Find server configs that handle a given file extension.
 * A file can match multiple servers (e.g., .ts → TypeScript + ESLint).
 */
export function findServersForExtension(ext: string): LSPServerConfig[] {
  return BUILTIN_SERVERS.filter((s) => s.extensions.includes(ext.toLowerCase()));
}
