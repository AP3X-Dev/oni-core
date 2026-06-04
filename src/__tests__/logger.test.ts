import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getLogger,
  setDefaultLogger,
  resetDefaultLogger,
  consoleLogger,
  noopLogger,
  type LoggerLike,
} from "../logger.js";

afterEach(() => {
  resetDefaultLogger();
  vi.restoreAllMocks();
});

describe("consoleLogger", () => {
  it("forwards each level to the matching console method", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    consoleLogger.debug("d");
    consoleLogger.info("i");
    consoleLogger.warn("w", { a: 1 });
    consoleLogger.error("e");

    expect(debug).toHaveBeenCalledWith("d");
    expect(info).toHaveBeenCalledWith("i");
    expect(warn).toHaveBeenCalledWith("w", { a: 1 });
    expect(error).toHaveBeenCalledWith("e");
  });
});

describe("noopLogger", () => {
  it("does not write to console", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    noopLogger.warn("should be silent");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("getLogger", () => {
  it("returns the injected logger when provided", () => {
    const custom: LoggerLike = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    expect(getLogger(custom)).toBe(custom);
  });

  it("falls back to the console default when none is injected", () => {
    expect(getLogger()).toBe(consoleLogger);
  });

  it("honors a process-wide default set via setDefaultLogger", () => {
    const custom: LoggerLike = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    setDefaultLogger(custom);
    expect(getLogger()).toBe(custom);
    resetDefaultLogger();
    expect(getLogger()).toBe(consoleLogger);
  });
});
