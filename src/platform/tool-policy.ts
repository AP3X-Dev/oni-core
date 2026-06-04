// ============================================================
// @oni.bot/core/platform - Tool policy wrappers
// ============================================================
// Reusable enforcement for ToolDefinition callers that want platform
// task scope and capability grants checked below the prompt layer.
// ============================================================

import type { ToolDefinition } from "../tools/types.js";
import {
  PlatformPolicyError,
  type RuntimePolicy,
} from "./policy.js";

const DEFAULT_PATH_ARGUMENTS = [
  "path",
  "paths",
  "file",
  "files",
  "filePath",
  "filePaths",
  "inputPath",
  "outputPath",
  "sourcePath",
  "targetPath",
  "dir",
  "directory",
  "cwd",
  "workspaceDir",
];

const DEFAULT_COMMAND_ARGUMENTS = [
  "command",
  "commands",
  "cmd",
  "script",
  "shellCommand",
];

export interface PlatformToolPolicyOptions {
  /**
   * Require a granted tool capability before executing. Defaults to true.
   */
  assertToolCapability?: boolean;
  /**
   * Override the capability name used for the tool check. Defaults to tool.name.
   */
  toolCapabilityName?: string;
  /**
   * Input fields whose string/string[] values should be checked as paths.
   * Defaults to path-like properties found in the tool's JSON schema.
   */
  pathArguments?: string[];
  /**
   * Input fields whose string/string[] values should be checked as commands.
   * Defaults to command-like properties found in the tool's JSON schema.
   */
  commandArguments?: string[];
  /**
   * Replace checked path inputs with their resolved allowed path.
   */
  rewritePaths?: boolean;
  /**
   * Require task-scope and capability-grant network access.
   */
  requiresNetwork?: boolean;
}

export type PlatformToolPolicyMap = Record<string, PlatformToolPolicyOptions>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inferArguments(schema: Record<string, unknown>, candidates: string[]): string[] {
  const properties = schema.properties;
  if (!isRecord(properties)) return [];
  return candidates.filter((candidate) => Object.prototype.hasOwnProperty.call(properties, candidate));
}

function resolveArgumentNames(
  explicit: string[] | undefined,
  schema: Record<string, unknown>,
  candidates: string[],
): string[] {
  return explicit ?? inferArguments(schema, candidates);
}

function stringList(value: unknown, key: string): string[] {
  if (value === undefined) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }
  throw new PlatformPolicyError(`Policy-protected input "${key}" must be a string or string array.`);
}

function rewriteStringList(original: unknown, resolved: string[]): string | string[] | undefined {
  if (typeof original === "string") return resolved[0];
  if (Array.isArray(original)) return resolved;
  return undefined;
}

function applyInputPolicy<TInput>(
  input: TInput,
  policy: RuntimePolicy,
  options: Required<Pick<PlatformToolPolicyOptions, "rewritePaths">> & {
    pathArguments: string[];
    commandArguments: string[];
  },
): TInput {
  if (!isRecord(input)) return input;

  const next: Record<string, unknown> = options.rewritePaths
    ? { ...input }
    : input;

  for (const key of options.pathArguments) {
    const value = input[key];
    const paths = stringList(value, key);
    if (paths.length === 0) continue;
    const resolved = paths.map((path) => policy.assertPathAllowed(path));
    const rewritten = rewriteStringList(value, resolved);
    if (options.rewritePaths && rewritten !== undefined) {
      next[key] = rewritten;
    }
  }

  for (const key of options.commandArguments) {
    const value = input[key];
    const commands = stringList(value, key);
    for (const command of commands) {
      policy.assertCommandAllowed(command);
    }
  }

  return next as TInput;
}

function mergeOptions(
  base: PlatformToolPolicyOptions | undefined,
  override: PlatformToolPolicyOptions | undefined,
): PlatformToolPolicyOptions {
  return {
    ...(base ?? {}),
    ...(override ?? {}),
  };
}

export function wrapToolWithRuntimePolicy<TInput, TOutput>(
  tool: ToolDefinition<TInput, TOutput>,
  policy: RuntimePolicy,
  options: PlatformToolPolicyOptions = {},
): ToolDefinition<TInput, TOutput> {
  const pathArguments = resolveArgumentNames(
    options.pathArguments,
    tool.schema,
    DEFAULT_PATH_ARGUMENTS,
  );
  const commandArguments = resolveArgumentNames(
    options.commandArguments,
    tool.schema,
    DEFAULT_COMMAND_ARGUMENTS,
  );

  return {
    ...tool,
    execute(input, ctx) {
      policy.assertGrantActive();
      if (options.assertToolCapability ?? true) {
        policy.assertCapability("tool", options.toolCapabilityName ?? tool.name);
      }
      if (options.requiresNetwork) {
        policy.assertNetworkAllowed();
      }
      const checkedInput = applyInputPolicy(input, policy, {
        pathArguments,
        commandArguments,
        rewritePaths: options.rewritePaths ?? false,
      });
      return tool.execute(checkedInput, ctx);
    },
  };
}

export function wrapToolsWithRuntimePolicy(
  tools: ToolDefinition[],
  policy: RuntimePolicy,
  optionsByTool: PlatformToolPolicyMap = {},
): ToolDefinition[] {
  return tools.map((tool) => wrapToolWithRuntimePolicy(
    tool,
    policy,
    mergeOptions(optionsByTool["*"], optionsByTool[tool.name]),
  ));
}
