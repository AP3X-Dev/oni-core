// ============================================================
// @oni.bot/hot-loader — watchExtensions
// ============================================================
// Watches a directory of extension files and registers/unregisters
// tool handlers in a DynamicToolRegistry as files change.
// ============================================================

import { watch as chokidarWatch } from "chokidar";
import { createJiti } from "jiti";
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  HotLoaderOptions,
  HotLoader,
  ToolHandlerFn,
  ToolSchema,
} from "./types.js";

const jiti = createJiti(import.meta.url, { interopDefault: true });

const DEFAULT_EXTENSIONS = new Set([".ts", ".js", ".mjs"]);

/**
 * Watches a directory for extension files and auto-registers their
 * exports into the provided DynamicToolRegistry.
 *
 * Each exported function becomes a registered tool. The function's
 * `.schema` property (if present) provides name, description, and
 * parameters metadata.
 */
export function watchExtensions(options: HotLoaderOptions): HotLoader {
  const {
    dir,
    registry,
    pattern,
    onLoad,
    onUnload,
    onError,
  } = options;

  const allowedExtensions = pattern
    ? parseExtensionsFromGlob(pattern)
    : DEFAULT_EXTENSIONS;

  // file path -> list of tool names registered from that file
  const fileToolMap = new Map<string, string[]>();

  function isMatchingFile(filePath: string): boolean {
    return allowedExtensions.has(extname(filePath));
  }

  function unloadFile(filePath: string): void {
    const tools = fileToolMap.get(filePath);
    if (!tools || tools.length === 0) return;

    for (const name of tools) {
      registry.unregister(name);
    }
    onUnload?.(filePath, tools);
    fileToolMap.delete(filePath);
  }

  function loadFile(filePath: string): void {
    if (!isMatchingFile(filePath)) return;

    // Unregister previous exports from this file first (for hot-swap)
    unloadFile(filePath);

    let mod: Record<string, unknown>;
    try {
      const absPath = resolve(filePath);
      const fileUrl = pathToFileURL(absPath).href;

      // Cache-bust: jiti caches by path, so we need to evict
      try {
        const requireCache = (jiti as unknown as { cache: Record<string, unknown> }).cache;
        if (requireCache) {
          delete requireCache[absPath];
          delete requireCache[fileUrl];
        }
      } catch {
        // cache eviction is best-effort
      }

      mod = jiti(absPath) as Record<string, unknown>;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      onError?.(filePath, error);
      return;
    }

    const registeredTools: string[] = [];

    // Walk exports: each function is a potential tool handler
    for (const [exportName, value] of Object.entries(mod)) {
      if (typeof value !== "function") continue;

      const handler = value as ToolHandlerFn & { schema?: ToolSchema };
      const schema = handler.schema;
      const toolName = schema?.name ?? exportName;

      registry.register(toolName, handler, {
        description: schema?.description,
        parameters: schema?.parameters,
      });

      registeredTools.push(toolName);
    }

    if (registeredTools.length > 0) {
      fileToolMap.set(filePath, registeredTools);
      onLoad?.(filePath, registeredTools);
    }
  }

  // Watch the directory directly (chokidar glob + cwd is unreliable on Windows)
  const watcher = chokidarWatch(dir, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
  });

  watcher.on("add", (absPath) => loadFile(absPath));
  watcher.on("change", (absPath) => loadFile(absPath));
  watcher.on("unlink", (absPath) => unloadFile(absPath));

  return {
    stop: () => { watcher.close(); },
    loaded: () => new Map(fileToolMap),
  };
}

/** Extract allowed extensions from a glob like "**\/*.{ts,js,mjs}" */
function parseExtensionsFromGlob(glob: string): Set<string> {
  const braceMatch = glob.match(/\.\{([^}]+)\}/);
  if (braceMatch) {
    return new Set(braceMatch[1].split(",").map((e) => `.${e.trim()}`));
  }
  const dotMatch = glob.match(/\*(\.\w+)$/);
  if (dotMatch) {
    return new Set([dotMatch[1]]);
  }
  return DEFAULT_EXTENSIONS;
}
