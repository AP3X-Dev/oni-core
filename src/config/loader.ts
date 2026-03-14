// ============================================================
// @oni.bot/core/config — Loader
// JSONC parser, deep merge, hierarchical config loading.
// ============================================================

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ONIConfig, LoadConfigOptions } from "./types.js";

// ─── JSONC Parsing ─────────────────────────────────────────────────────────

/**
 * Strip comments from JSONC text.
 * Handles:
 * - `//` line comments
 * - `/* ... * /` block comments
 * - Preserves comments inside quoted strings
 * - Handles escaped quotes within strings
 */
export function stripJsonComments(text: string): string {
  let result = "";
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];

    // String literal — copy verbatim until closing quote
    if (ch === '"') {
      result += ch;
      i++;
      while (i < len) {
        const sc = text[i];
        result += sc;
        if (sc === "\\") {
          // Escaped character — copy next char too
          i++;
          if (i < len) {
            result += text[i];
          }
        } else if (sc === '"') {
          break;
        }
        i++;
      }
      i++;
      continue;
    }

    // Line comment //
    if (ch === "/" && i + 1 < len && text[i + 1] === "/") {
      // Skip to end of line
      i += 2;
      while (i < len && text[i] !== "\n") {
        i++;
      }
      continue;
    }

    // Block comment /* ... */
    if (ch === "/" && i + 1 < len && text[i + 1] === "*") {
      i += 2;
      while (i < len) {
        if (text[i] === "*" && i + 1 < len && text[i + 1] === "/") {
          i += 2;
          break;
        }
        // Preserve newlines to maintain line numbers for error messages
        if (text[i] === "\n") {
          result += "\n";
        }
        i++;
      }
      continue;
    }

    // Normal character
    result += ch;
    i++;
  }

  return result;
}

/**
 * Parse a JSONC string (JSON with comments) into a value.
 * Strips comments first, then delegates to JSON.parse.
 */
export function parseJsonc(text: string): unknown {
  const cleaned = stripJsonComments(text);
  return JSON.parse(cleaned);
}

// ─── Deep Merge ────────────────────────────────────────────────────────────

/**
 * Deep merge two objects. Object keys are merged recursively.
 * Arrays and primitives are replaced (not merged).
 * undefined values in override are skipped (don't overwrite base).
 * null values in override DO replace base values.
 *
 * Does NOT mutate base or override — returns a new object.
 */
export function deepMerge<T extends Record<string, unknown>>(
  base: T,
  override: Partial<T>,
): T {
  const result = { ...base };

  for (const key of Object.keys(override) as Array<keyof T>) {
    const overrideVal = override[key];

    // Skip undefined — don't overwrite base
    if (overrideVal === undefined) continue;

    const baseVal = base[key];

    // If both are plain objects, merge recursively
    if (
      isPlainObject(baseVal) &&
      isPlainObject(overrideVal)
    ) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overrideVal as Record<string, unknown>,
      ) as T[keyof T];
    } else {
      // Replace (arrays, primitives, null)
      result[key] = overrideVal as T[keyof T];
    }
  }

  return result;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === "object" && !Array.isArray(val);
}

// ─── Env-var Expansion ─────────────────────────────────────────────────────

/**
 * Recursively expand `${VAR}` references in string values using process.env.
 * Unresolved variables are left as-is (e.g. `${MISSING}` stays `${MISSING}`).
 * Non-string values pass through unchanged.
 */
function expandEnvVars(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([^}]+)\}/g, (match, varName: string) =>
      process.env[varName] ?? match,
    );
  }
  if (Array.isArray(value)) {
    return value.map(expandEnvVars);
  }
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = expandEnvVars(v);
    }
    return result;
  }
  return value;
}

// ─── Config Loading ────────────────────────────────────────────────────────

/**
 * Load and merge ONI configuration from hierarchical paths.
 *
 * Resolution order (last wins):
 * 1. `~/.oni/config.jsonc` — global defaults
 * 2. `<projectDir>/oni.jsonc` — project-level
 * 3. `<projectDir>/.oni/config.jsonc` — alternative project-level
 * 4. `inline` option — programmatic override (highest priority)
 *
 * Invalid files are silently skipped (logged but don't throw).
 */
export async function loadConfig(
  options?: LoadConfigOptions,
): Promise<ONIConfig> {
  const globalDir = options?.globalDir ?? join(homedir(), ".oni");
  const projectDir = options?.projectDir ?? process.cwd();

  // Collect config file paths in priority order (first = lowest priority)
  const configPaths = [
    join(globalDir, "config.jsonc"),
    join(projectDir, "oni.jsonc"),
    join(projectDir, ".oni", "config.jsonc"),
  ];

  let merged: ONIConfig = {};

  for (const configPath of configPaths) {
    const partial = await loadSingleConfig(configPath);
    if (partial) {
      merged = mergeConfig(merged, partial);
    }
  }

  // Inline overrides (highest priority)
  if (options?.inline) {
    merged = mergeConfig(merged, options.inline);
  }

  return merged;
}

/**
 * Merge two ONI configs with special handling:
 * - `lsp: false` replaces any existing lsp config
 * - Otherwise uses deepMerge
 */
function mergeConfig(
  base: ONIConfig,
  override: Partial<ONIConfig>,
): ONIConfig {
  // Special case: lsp: false means "disable all LSP" — don't merge
  if (override.lsp === false) {
    return { ...deepMerge(base as Record<string, unknown>, override as Record<string, unknown>) as ONIConfig, lsp: false };
  }
  return deepMerge(
    base as Record<string, unknown>,
    override as Record<string, unknown>,
  ) as ONIConfig;
}

/**
 * Load a single JSONC config file. Returns null if file doesn't exist
 * or can't be parsed.
 */
async function loadSingleConfig(
  path: string,
): Promise<Partial<ONIConfig> | null> {
  let text: string;
  try {
    text = await readFile(path, "utf-8");
  } catch {
    // File doesn't exist or can't be read — skip silently
    return null;
  }
  try {
    const parsed = parseJsonc(text);
    if (isPlainObject(parsed)) {
      return expandEnvVars(parsed) as Partial<ONIConfig>;
    }
    return null;
  } catch (err) {
    // Parse error — log so the user knows their config was ignored
    console.warn(`[oni] Config parse error in "${path}": ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
