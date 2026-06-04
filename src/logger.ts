// ============================================================
// @oni.bot/core — Injectable logger
// ============================================================
// Library and server modules must not hard-code console.*: in multi-tenant
// or background-agent deployments stdout is shared and unstructured logs are
// useless for audit/observability. This provides a minimal injectable logger
// (mirroring the TracerLike pattern in telemetry.ts) with a console-backed
// default so existing behavior is unchanged until a host injects its own sink.
// ============================================================

export interface LoggerLike {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

function emit(
  method: "debug" | "info" | "warn" | "error",
  message: string,
  data?: Record<string, unknown>,
): void {
  const sink = console[method] ?? console.log;
  if (data === undefined) sink(message);
  else sink(message, data);
}

/** Default logger: forwards to console.* (preserves pre-injection behavior). */
export const consoleLogger: LoggerLike = {
  debug: (message, data) => emit("debug", message, data),
  info: (message, data) => emit("info", message, data),
  warn: (message, data) => emit("warn", message, data),
  error: (message, data) => emit("error", message, data),
};

/** Silent logger: useful for tests and for hosts that capture output elsewhere. */
export const noopLogger: LoggerLike = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

let defaultLogger: LoggerLike = consoleLogger;

/**
 * Install a process-wide default logger. Library modules that are not given an
 * explicit logger fall back to this, so a host can route all internal logs to
 * a structured sink (or silence them) with a single call.
 */
export function setDefaultLogger(logger: LoggerLike): void {
  defaultLogger = logger;
}

/** Restore the console-backed default logger. */
export function resetDefaultLogger(): void {
  defaultLogger = consoleLogger;
}

/**
 * Resolve the logger to use: an explicitly injected one wins, otherwise the
 * process-wide default. Call sites use `getLogger(opts?.logger).warn(...)`.
 */
export function getLogger(injected?: LoggerLike): LoggerLike {
  return injected ?? defaultLogger;
}
