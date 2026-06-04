import { readFile, writeFile, readdir, mkdir, unlink, stat } from "node:fs/promises";
import { realpathSync, existsSync } from "node:fs";
import { resolve, normalize, dirname, basename, join, sep } from "node:path";
import type { ToolDefinition, ToolContext } from "../types.js";

/**
 * Resolve the real filesystem path, following symlinks.
 * If the target does not exist, walk up to the deepest existing ancestor
 * and resolve that (covers write-to-new-file scenarios).
 */
function resolveReal(filePath: string): string {
  const abs = normalize(resolve(filePath));
  if (existsSync(abs)) {
    return realpathSync(abs);
  }
  // For non-existent paths, resolve the deepest existing ancestor
  // and reconstruct the full path with remaining unresolved segments.
  let current = abs;
  const tail: string[] = [];
  while (!existsSync(current)) {
    tail.unshift(basename(current));
    const parent = dirname(current);
    if (parent === current) break; // filesystem root
    current = parent;
  }
  return join(realpathSync(current), ...tail);
}

function checkAllowedPath(filePath: string, allowedPaths: string[]): string {
  if (allowedPaths.length === 0) {
    throw new Error("Access denied: allowedPaths is empty — at least one allowed path must be configured");
  }
  const normalized = normalize(resolve(filePath));
  const normalizedAllowed = allowedPaths.map((ap) => normalize(resolve(ap)));

  // Lexical check first (fast path).
  const lexicalOk = normalizedAllowed.some((ap) => normalized === ap || normalized.startsWith(ap + sep));
  if (!lexicalOk) {
    throw new Error(
      `Access denied: path "${filePath}" is not within allowed paths: ${allowedPaths.join(", ")}`
    );
  }

  // Follow symlinks and re-check to prevent symlink-based escapes.
  const real = resolveReal(filePath);
  const realAllowed = normalizedAllowed.some((ap) => {
    const realAp = existsSync(ap) ? realpathSync(ap) : ap;
    return real === realAp || real.startsWith(realAp + sep);
  });
  if (!realAllowed) {
    throw new Error(
      `Access denied: path "${filePath}" resolves via symlink to "${real}" which is outside allowed paths: ${allowedPaths.join(", ")}`
    );
  }

  return real;
}

interface ReadFileInput {
  path: string;
  encoding?: "utf8" | "base64";
}

interface WriteFileInput {
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
}

interface ListDirInput {
  path: string;
  recursive?: boolean;
}

interface PathInput {
  path: string;
}

import type { RuntimePolicyLike } from "../runtime-policy.js";
export type {
  RuntimePolicyCapabilityType,
  RuntimePolicyLike,
} from "../runtime-policy.js";

export interface FileSystemToolsOptions {
  allowedPaths?: string[];
  runtimePolicy?: RuntimePolicyLike;
  assertToolCapability?: boolean;
}

function resolveFileSystemPath(
  filePath: string,
  allowedPaths: string[],
  toolName: string,
  opts: FileSystemToolsOptions,
): string {
  if (opts.runtimePolicy) {
    opts.runtimePolicy.assertGrantActive();
    if (opts.assertToolCapability ?? true) {
      opts.runtimePolicy.assertCapability("tool", toolName);
    }
    return opts.runtimePolicy.assertPathAllowed(filePath);
  }

  return checkAllowedPath(filePath, allowedPaths);
}

export function fileSystemTools(opts?: FileSystemToolsOptions): ToolDefinition[] {
  const options = opts ?? {};
  const { allowedPaths = [process.cwd()] } = options;

  const readFileTool: ToolDefinition = {
    name: "fs_read_file",
    description: "Read the contents of a file from the filesystem",
    schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative path to the file" },
        encoding: {
          type: "string",
          enum: ["utf8", "base64"],
          description: "File encoding (default: utf8)",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    parallelSafe: true,
    execute: async (input: unknown, _ctx: ToolContext) => {
      const i = input as ReadFileInput;
      const safePath = resolveFileSystemPath(i.path, allowedPaths, readFileTool.name, options);
      const content = await readFile(safePath, { encoding: i.encoding ?? "utf8" });
      return { path: i.path, content };
    },
  };

  const writeFileTool: ToolDefinition = {
    name: "fs_write_file",
    description: "Write content to a file on the filesystem",
    schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative path to the file" },
        content: { type: "string", description: "Content to write" },
        encoding: {
          type: "string",
          enum: ["utf8", "base64"],
          description: "File encoding (default: utf8)",
        },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    parallelSafe: false,
    execute: async (input: unknown, _ctx: ToolContext) => {
      const i = input as WriteFileInput;
      const safePath = resolveFileSystemPath(i.path, allowedPaths, writeFileTool.name, options);
      await writeFile(safePath, i.content, { encoding: i.encoding ?? "utf8" });
      return { path: i.path, success: true };
    },
  };

  const listDirectoryTool: ToolDefinition = {
    name: "fs_list_directory",
    description: "List files and directories in a given directory",
    schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path to list" },
        recursive: { type: "boolean", description: "List recursively (default: false)" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    parallelSafe: true,
    execute: async (input: unknown, _ctx: ToolContext) => {
      const i = input as ListDirInput;
      const safePath = resolveFileSystemPath(i.path, allowedPaths, listDirectoryTool.name, options);
      const entries = await readdir(safePath, { withFileTypes: true, recursive: !!i.recursive });
      const items = entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "directory" : "file",
      }));
      return { path: i.path, items };
    },
  };

  const createDirectoryTool: ToolDefinition = {
    name: "fs_create_directory",
    description: "Create a directory (and any intermediate directories)",
    schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path to create" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    parallelSafe: false,
    execute: async (input: unknown, _ctx: ToolContext) => {
      const i = input as PathInput;
      const safePath = resolveFileSystemPath(i.path, allowedPaths, createDirectoryTool.name, options);
      await mkdir(safePath, { recursive: true });
      return { path: i.path, success: true };
    },
  };

  const deleteFileTool: ToolDefinition = {
    name: "fs_delete_file",
    description: "Delete a file from the filesystem",
    schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to delete" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    parallelSafe: false,
    execute: async (input: unknown, _ctx: ToolContext) => {
      const i = input as PathInput;
      const safePath = resolveFileSystemPath(i.path, allowedPaths, deleteFileTool.name, options);
      await unlink(safePath);
      return { path: i.path, success: true };
    },
  };

  const getFileInfoTool: ToolDefinition = {
    name: "fs_get_file_info",
    description: "Get metadata about a file or directory (size, type, timestamps)",
    schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file or directory" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    parallelSafe: true,
    execute: async (input: unknown, _ctx: ToolContext) => {
      const i = input as PathInput;
      const safePath = resolveFileSystemPath(i.path, allowedPaths, getFileInfoTool.name, options);
      const stats = await stat(safePath);
      return {
        path: i.path,
        size: stats.size,
        type: stats.isDirectory() ? "directory" : stats.isFile() ? "file" : "other",
        createdAt: stats.birthtime.toISOString(),
        modifiedAt: stats.mtime.toISOString(),
        accessedAt: stats.atime.toISOString(),
      };
    },
  };

  return [
    readFileTool,
    writeFileTool,
    listDirectoryTool,
    createDirectoryTool,
    deleteFileTool,
    getFileInfoTool,
  ];
}
