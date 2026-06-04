// ============================================================
// Branch-coverage tests for CLI command handlers.
// Targets: src/cli/build.ts, run.ts, dev.ts, test.ts, inspect.ts, init.ts
//
// Deterministic: node:child_process spawn and node:fs/promises are
// mocked. No real spawn, network, or filesystem outside the mocks.
// ============================================================

import { EventEmitter } from "node:events";
import { resolve, sep } from "node:path";
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";

// ------------------------------------------------------------
// Mock node:child_process — capture spawn calls and hand back a
// controllable fake ChildProcess (EventEmitter with stdout/stderr/kill).
// ------------------------------------------------------------
interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: Mock;
}

function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

// ------------------------------------------------------------
// Mock node:fs/promises — used by build (readFile) and init
// (mkdir/writeFile). Each test sets behavior explicitly.
// ------------------------------------------------------------
const readFileMock = vi.fn();
const mkdirMock = vi.fn();
const writeFileMock = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
  mkdir: (...args: unknown[]) => mkdirMock(...args),
  writeFile: (...args: unknown[]) => writeFileMock(...args),
}));

// Import AFTER mocks are registered (vi.mock is hoisted, so this is safe).
import { buildCommand, validateExports } from "../cli/build.js";
import { runCommand, resolveEntryFile, formatDuration } from "../cli/run.js";
import { devCommand, resolveDevFile } from "../cli/dev.js";
import { testCommand } from "../cli/test.js";
import { inspectCommand, formatGraphTable } from "../cli/inspect.js";
import { initProject, initCommand } from "../cli/init.js";
import type { ParsedArgs } from "../cli/router.js";

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function args(
  positional: string[] = [],
  flags: Record<string, string> = {},
): ParsedArgs {
  return { command: "x", positional, flags };
}

/**
 * Drive a command that spawns a child, then resolve it by emitting
 * the requested terminal event on the fake child once the command has
 * actually registered its listeners.
 *
 * Some commands (e.g. dev) `await import(...)` before calling spawn, so
 * we poll across microtask/macrotask boundaries until spawn is invoked,
 * then give the command a tick to attach its `.on` listeners before
 * emitting the terminal event.
 */
async function driveWithChild(
  run: () => Promise<void>,
  emit: (child: FakeChild) => void,
): Promise<FakeChild> {
  const child = makeFakeChild();
  const callsBefore = spawnMock.mock.calls.length;
  spawnMock.mockReturnValueOnce(child);
  const promise = run();

  // Wait until this command has called spawn.
  for (let i = 0; i < 200 && spawnMock.mock.calls.length === callsBefore; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
  // Let the command attach its event listeners.
  await new Promise((r) => setTimeout(r, 0));

  emit(child);
  await promise;
  return child;
}

let logSpy: Mock;
let errSpy: Mock;
let exitSpy: Mock;

beforeEach(() => {
  spawnMock.mockReset();
  readFileMock.mockReset();
  mkdirMock.mockReset();
  writeFileMock.mockReset();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {}) as unknown as Mock;
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {}) as unknown as Mock;
  // process.exit must never actually exit the test runner.
  exitSpy = vi
    .spyOn(process, "exit")
    .mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never) as unknown as Mock;
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

// ============================================================
// build.ts
// ============================================================
describe("buildCommand", () => {
  it("validateExports flags missing types and import", () => {
    expect(
      validateExports({ exports: { ".": { import: "./i.js" } } })[0],
    ).toContain("types");
    expect(
      validateExports({ exports: { "./s": { types: "./s.d.ts" } } })[0],
    ).toContain("import");
    expect(validateExports({})).toEqual([]);
    expect(
      validateExports({ exports: { ".": "./index.js" } }),
    ).toEqual([]);
  });

  it("succeeds and reports passing export validation (close code 0)", async () => {
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({
        exports: { ".": { import: "./dist/index.js", types: "./dist/index.d.ts" } },
      }),
    );

    await driveWithChild(
      () => buildCommand(args([], {})),
      (child) => child.emit("close", 0),
    );

    // tsc invoked without --noCheck
    expect(spawnMock).toHaveBeenCalledWith("npx", ["tsc"], { stdio: "inherit" });
    const logs = logSpy.mock.calls.flat().join("\n");
    expect(logs).toContain("TypeScript compilation successful");
    expect(logs).toContain("Export validation passed");
    expect(logs).toContain("Build complete!");
    expect(process.exitCode).toBeUndefined();
  });

  it("emits export validation WARNINGS (not failure) for invalid exports", async () => {
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({ exports: { ".": { import: "./dist/index.js" } } }),
    );

    await driveWithChild(
      () => buildCommand(args([], {})),
      (child) => child.emit("close", 0),
    );

    const logs = logSpy.mock.calls.flat().join("\n");
    expect(logs).toContain("Export validation warnings:");
    expect(logs).toContain("missing \"types\" field");
    // Warnings do not fail the build.
    expect(process.exitCode).toBeUndefined();
  });

  it("passes --noCheck when no-check flag set", async () => {
    readFileMock.mockResolvedValueOnce(JSON.stringify({}));

    await driveWithChild(
      () => buildCommand(args([], { "no-check": "true" })),
      (child) => child.emit("close", 0),
    );

    expect(spawnMock).toHaveBeenCalledWith("npx", ["tsc", "--noCheck"], {
      stdio: "inherit",
    });
  });

  it("propagates non-zero tsc exit code as build failure", async () => {
    await driveWithChild(
      () => buildCommand(args([], {})),
      (child) => child.emit("close", 2),
    );

    expect(errSpy.mock.calls.flat().join("\n")).toContain("Build failed");
    expect(process.exitCode).toBe(2);
    // readFile (export validation) must NOT run on failure.
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("treats a null close code as failure (exit code 1)", async () => {
    await driveWithChild(
      () => buildCommand(args([], {})),
      (child) => child.emit("close", null),
    );

    expect(process.exitCode).toBe(1);
  });

  it("handles spawn error (ENOENT) on the build child", async () => {
    await driveWithChild(
      () => buildCommand(args([], {})),
      (child) => child.emit("error", new Error("spawn npx ENOENT")),
    );

    expect(errSpy.mock.calls.flat().join("\n")).toContain("Failed to spawn npx");
    expect(process.exitCode).toBe(1);
  });

  it("skips export validation gracefully when package.json read fails", async () => {
    readFileMock.mockRejectedValueOnce(new Error("ENOENT"));

    await driveWithChild(
      () => buildCommand(args([], {})),
      (child) => child.emit("close", 0),
    );

    const logs = logSpy.mock.calls.flat().join("\n");
    expect(logs).toContain("Build complete!");
    expect(logs).not.toContain("Export validation passed");
    expect(process.exitCode).toBeUndefined();
  });
});

// ============================================================
// run.ts
// ============================================================
describe("runCommand", () => {
  it("resolveEntryFile / formatDuration helpers", () => {
    expect(resolveEntryFile("a/b")).toBe("a/b.ts");
    expect(resolveEntryFile("a/b.js")).toBe("a/b.js");
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(1500)).toBe("1.50s");
    expect(formatDuration(65_000)).toBe("1m 5s");
  });

  it("errors when no file is provided", async () => {
    await runCommand(args([], {}));
    expect(errSpy.mock.calls.flat().join("\n")).toContain("file required");
    expect(process.exitCode).toBe(1);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("spawns tsx with resolved absolute entry file and succeeds (code 0)", async () => {
    const child = await driveWithChild(
      () => runCommand(args(["src/agent"], {})),
      (c) => c.emit("close", 0),
    );

    expect(child).toBeDefined();
    const [, spawnArgs] = spawnMock.mock.calls[0]!;
    expect(spawnArgs[0]).toBe("tsx");
    // ".ts" appended and resolved to an absolute path.
    expect(spawnArgs[1]).toBe(resolve(process.cwd(), "src/agent.ts"));
    expect(process.exitCode).toBeUndefined();
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Completed in");
  });

  it("propagates the child's non-zero exit code", async () => {
    await driveWithChild(
      () => runCommand(args(["src/agent.ts"], {})),
      (c) => c.emit("close", 3),
    );
    expect(process.exitCode).toBe(3);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("exit code: 3");
  });

  it("treats a null exit code as 1", async () => {
    await driveWithChild(
      () => runCommand(args(["src/agent.ts"], {})),
      (c) => c.emit("close", null),
    );
    expect(process.exitCode).toBe(1);
  });

  it("handles spawn error (ENOENT)", async () => {
    await driveWithChild(
      () => runCommand(args(["src/agent.ts"], {})),
      (c) => c.emit("error", new Error("spawn npx ENOENT")),
    );
    expect(errSpy.mock.calls.flat().join("\n")).toContain("ENOENT");
    expect(process.exitCode).toBe(1);
  });
});

// ============================================================
// dev.ts
// ============================================================
describe("devCommand", () => {
  it("resolveDevFile helper", () => {
    expect(resolveDevFile(undefined)).toBe("src/index.ts");
    expect(resolveDevFile("src/x.ts")).toBe("src/x.ts");
  });

  it("rejects an entry file outside the project directory", async () => {
    // An absolute path that resolves outside cwd is rejected before spawning.
    const outside =
      process.platform === "win32" ? "C:\\Windows\\System32\\evil.ts" : "/etc/evil.ts";
    await devCommand(args([outside], {}));
    expect(errSpy.mock.calls.flat().join("\n")).toContain(
      "must be within the project directory",
    );
    expect(process.exitCode).toBe(1);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("spawns tsx watch, honors --port, and sets ONI env on success", async () => {
    const child = await driveWithChild(
      () => devCommand(args(["src/index.ts"], { port: "5555" })),
      (c) => c.emit("close", 0),
    );

    const [cmd, spawnArgs, opts] = spawnMock.mock.calls[0]! as [
      string,
      string[],
      { env: Record<string, string> },
    ];
    expect(cmd).toBe("npx");
    expect(spawnArgs[0]).toBe("tsx");
    expect(spawnArgs[1]).toBe("watch");
    expect(spawnArgs[2]).toBe(resolve(process.cwd(), "src/index.ts"));
    expect(opts.env.ONI_DEV).toBe("true");
    expect(opts.env.ONI_PORT).toBe("5555");
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Port: 5555");
    // close code 0 -> no exit code set
    expect(process.exitCode).toBeUndefined();
    // SIGINT listeners cleaned up on close.
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("defaults port to 4100 and entry to src/index.ts when omitted", async () => {
    await driveWithChild(
      () => devCommand(args([], {})),
      (c) => c.emit("close", 0),
    );
    const [, spawnArgs, opts] = spawnMock.mock.calls[0]! as [
      string,
      string[],
      { env: Record<string, string> },
    ];
    expect(spawnArgs[2]).toBe(resolve(process.cwd(), "src/index.ts"));
    expect(opts.env.ONI_PORT).toBe("4100");
  });

  it("propagates a non-zero child close code", async () => {
    await driveWithChild(
      () => devCommand(args(["src/index.ts"], {})),
      (c) => c.emit("close", 7),
    );
    expect(process.exitCode).toBe(7);
  });

  it("handles spawn error (ENOENT) and cleans up listeners", async () => {
    const before = process.listenerCount("SIGINT");
    await driveWithChild(
      () => devCommand(args(["src/index.ts"], {})),
      (c) => c.emit("error", new Error("spawn npx ENOENT")),
    );
    expect(errSpy.mock.calls.flat().join("\n")).toContain("Failed to spawn npx");
    expect(process.exitCode).toBe(1);
    // The cleanup handler registered during the call is removed on error.
    expect(process.listenerCount("SIGINT")).toBe(before);
  });
});

// ============================================================
// test.ts
// ============================================================
describe("testCommand", () => {
  it("runs vitest in 'run' mode by default", async () => {
    await driveWithChild(
      () => testCommand(args([], {})),
      (c) => c.emit("close", 0),
    );
    expect(spawnMock).toHaveBeenCalledWith("npx", ["vitest", "run"], {
      stdio: "inherit",
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("uses --watch with the watch flag and appends a pattern + verbose reporter", async () => {
    await driveWithChild(
      () =>
        testCommand(
          args(["my-pattern"], { watch: "true", verbose: "true" }),
        ),
      (c) => c.emit("close", 0),
    );
    const [, spawnArgs] = spawnMock.mock.calls[0]! as [string, string[]];
    expect(spawnArgs).toEqual([
      "vitest",
      "--watch",
      "my-pattern",
      "--reporter=verbose",
    ]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain(
      "matching: my-pattern",
    );
  });

  it("treats the -w short flag the same as --watch", async () => {
    await driveWithChild(
      () => testCommand(args([], { w: "true" })),
      (c) => c.emit("close", 0),
    );
    const [, spawnArgs] = spawnMock.mock.calls[0]! as [string, string[]];
    expect(spawnArgs).toContain("--watch");
    expect(spawnArgs).not.toContain("run");
  });

  it("propagates non-zero exit codes", async () => {
    await driveWithChild(
      () => testCommand(args([], {})),
      (c) => c.emit("close", 5),
    );
    expect(process.exitCode).toBe(5);
  });

  it("handles spawn error (ENOENT)", async () => {
    await driveWithChild(
      () => testCommand(args([], {})),
      (c) => c.emit("error", new Error("spawn npx ENOENT")),
    );
    expect(errSpy.mock.calls.flat().join("\n")).toContain("ENOENT");
    expect(process.exitCode).toBe(1);
  });
});

// ============================================================
// inspect.ts
// ============================================================
describe("inspectCommand", () => {
  it("formatGraphTable renders nodes, edges, cycles, and terminals", () => {
    const table = formatGraphTable({
      nodes: [
        { id: "__start__", type: "start", hasRetry: false, isSubgraph: false },
        { id: "agent", type: "node", hasRetry: false, isSubgraph: false },
        { id: "__end__", type: "end", hasRetry: false, isSubgraph: false },
      ],
      edges: [
        { from: "__start__", to: "agent", type: "static" },
        { from: "agent", to: "__end__", type: "conditional" },
      ],
      terminals: ["agent"],
      cycles: [["agent", "router"]],
      topoOrder: ["__start__", "agent", "__end__"],
    });
    expect(table).toContain("(entry)");
    expect(table).toContain("(exit)");
    expect(table).toContain("(conditional)");
    expect(table).toContain("Topological Order:");
    // a cycle was supplied, so the "no cycles" branch is not hit
    expect(table).not.toContain("No cycles detected");
  });

  it("formatGraphTable handles null topoOrder and empty cycles", () => {
    const table = formatGraphTable({
      nodes: [],
      edges: [],
      terminals: ["x"],
      cycles: [],
      topoOrder: null,
    });
    expect(table).toContain("graph has cycles, no topological order");
    expect(table).toContain("No cycles detected");
  });

  it("errors when no file argument is provided", async () => {
    await inspectCommand(args([], {}));
    expect(errSpy.mock.calls.flat().join("\n")).toContain("file required");
    expect(process.exitCode).toBe(1);
  });

  it("rejects files outside the project directory (cwd boundary)", async () => {
    const outside =
      process.platform === "win32"
        ? "C:\\Windows\\System32\\graph.ts"
        : "/etc/graph.ts";
    await inspectCommand(args([outside], {}));
    expect(errSpy.mock.calls.flat().join("\n")).toContain(
      "must be within the project directory",
    );
    expect(process.exitCode).toBe(1);
  });

  it("rejects unsupported file extensions", async () => {
    await inspectCommand(args(["graph.txt"], {}));
    expect(errSpy.mock.calls.flat().join("\n")).toContain(
      "unsupported file extension",
    );
    expect(process.exitCode).toBe(1);
  });

  it("reports an error when importing a non-existent (but allowed) file", async () => {
    // Resolves inside cwd with an allowed extension, so it reaches the
    // dynamic import, which throws because the file does not exist.
    const missing = `__inspect_missing_${Date.now()}.ts`;
    await inspectCommand(args([missing], {}));
    expect(errSpy.mock.calls.flat().join("\n")).toContain("Error:");
    expect(process.exitCode).toBe(1);
  });
});

// ============================================================
// init.ts
// ============================================================
describe("initCommand / initProject", () => {
  it("errors when project name is missing", async () => {
    await initCommand(args([], {}));
    expect(errSpy.mock.calls.flat().join("\n")).toContain(
      "project name required",
    );
    expect(process.exitCode).toBe(1);
    expect(mkdirMock).not.toHaveBeenCalled();
  });

  it("creates the project: mkdir dirs and writes all template files", async () => {
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);

    await initCommand(args(["my-swarm"], {}));

    const target = resolve(process.cwd(), "my-swarm");
    expect(mkdirMock).toHaveBeenCalledWith(target, { recursive: true });
    // Six template files are written.
    expect(writeFileMock).toHaveBeenCalledTimes(6);
    const written = writeFileMock.mock.calls.map((c) => c[0] as string);
    expect(written).toContain(`${target}${sep}package.json`);
    expect(written.some((p) => p.endsWith(`${sep}src${sep}index.ts`))).toBe(true);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Done!");
    expect(process.exitCode).toBeUndefined();
  });

  it("uses basename for the package name when a nested path is given", async () => {
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);

    await initCommand(args(["nested/path/cool-proj"], {}));

    const pkgCall = writeFileMock.mock.calls.find((c) =>
      (c[0] as string).endsWith(`${sep}package.json`),
    );
    expect(pkgCall).toBeDefined();
    // Template embeds the basename, not the full path.
    expect(pkgCall![1] as string).toContain('"name": "cool-proj"');
  });

  it("wraps and rethrows filesystem errors (e.g. existing/locked file)", async () => {
    mkdirMock.mockResolvedValue(undefined);
    // First writeFile fails as if the file already exists / is not writable.
    writeFileMock.mockRejectedValueOnce(
      Object.assign(new Error("EEXIST: file already exists"), { code: "EEXIST" }),
    );

    await expect(
      initProject("dup", resolve(process.cwd(), "dup")),
    ).rejects.toThrow(/Failed to initialize project in .*: EEXIST/);
  });

  it("propagates mkdir failures through the wrapped error", async () => {
    mkdirMock.mockRejectedValueOnce(new Error("EACCES: permission denied"));

    await expect(
      initProject("nope", resolve(process.cwd(), "nope")),
    ).rejects.toThrow(/Failed to initialize project/);
    expect(writeFileMock).not.toHaveBeenCalled();
  });
});
