import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  stripJsonComments,
  parseJsonc,
  deepMerge,
  loadConfig,
} from "../config/loader.js";
import type { ONIConfig } from "../config/types.js";

// ── stripJsonComments ───────────────────────────────────────

describe("stripJsonComments", () => {
  it("strips line comments", () => {
    const input = '{\n  "key": "value" // this is a comment\n}';
    expect(JSON.parse(stripJsonComments(input))).toEqual({ key: "value" });
  });

  it("strips block comments", () => {
    const input = '{\n  /* block comment */\n  "key": "value"\n}';
    expect(JSON.parse(stripJsonComments(input))).toEqual({ key: "value" });
  });

  it("strips multi-line block comments", () => {
    const input = '{\n  /*\n   * multi\n   * line\n   */\n  "key": 1\n}';
    expect(JSON.parse(stripJsonComments(input))).toEqual({ key: 1 });
  });

  it("preserves // inside strings", () => {
    const input = '{"url": "https://example.com"}';
    expect(JSON.parse(stripJsonComments(input))).toEqual({
      url: "https://example.com",
    });
  });

  it("preserves /* inside strings", () => {
    const input = '{"comment": "use /* to start */"}';
    expect(JSON.parse(stripJsonComments(input))).toEqual({
      comment: "use /* to start */",
    });
  });

  it("handles escaped quotes in strings", () => {
    const input = '{"key": "val\\"ue"} // comment';
    expect(JSON.parse(stripJsonComments(input))).toEqual({ key: 'val"ue' });
  });

  it("returns empty object for empty input", () => {
    expect(stripJsonComments("")).toBe("");
  });

  it("handles trailing commas in arrays", () => {
    // Note: trailing commas are NOT valid JSON — stripJsonComments only strips comments.
    // This test confirms it doesn't break non-comment content.
    const input = '{"arr": [1, 2, 3]}';
    expect(JSON.parse(stripJsonComments(input))).toEqual({ arr: [1, 2, 3] });
  });

  it("handles comment-only input", () => {
    const input = "// just a comment";
    expect(stripJsonComments(input).trim()).toBe("");
  });

  it("handles adjacent comments", () => {
    const input =
      '{\n  "a": 1, // first\n  "b": 2 // second\n}';
    expect(JSON.parse(stripJsonComments(input))).toEqual({ a: 1, b: 2 });
  });
});

// ── parseJsonc ──────────────────────────────────────────────

describe("parseJsonc", () => {
  it("parses standard JSON", () => {
    expect(parseJsonc('{"key": "value"}')).toEqual({ key: "value" });
  });

  it("parses JSONC with comments", () => {
    const input = `{
      // Model config
      "model": {
        "provider": "anthropic",
        "model": "claude-sonnet-4-20250514"
      },
      /* Swarm settings */
      "swarm": {
        "maxConcurrency": 4
      }
    }`;
    expect(parseJsonc(input)).toEqual({
      model: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
      swarm: { maxConcurrency: 4 },
    });
  });

  it("throws on invalid JSON (after stripping comments)", () => {
    expect(() => parseJsonc("{invalid}")).toThrow();
  });

  it("parses empty object", () => {
    expect(parseJsonc("{}")).toEqual({});
  });

  it("parses with trailing comment", () => {
    expect(parseJsonc('{"x": 1} // done')).toEqual({ x: 1 });
  });
});

// ── deepMerge ───────────────────────────────────────────────

describe("deepMerge", () => {
  it("merges flat objects", () => {
    expect(deepMerge({ a: 1, b: 2 }, { b: 3, c: 4 })).toEqual({
      a: 1,
      b: 3,
      c: 4,
    });
  });

  it("deep merges nested objects", () => {
    const base = { model: { provider: "openai", model: "gpt-4" }, swarm: { poolSize: 4 } };
    const override = { model: { model: "gpt-4o" } };
    expect(deepMerge(base, override)).toEqual({
      model: { provider: "openai", model: "gpt-4o" },
      swarm: { poolSize: 4 },
    });
  });

  it("replaces arrays (does not merge them)", () => {
    const base = { plugins: ["a", "b"] };
    const override = { plugins: ["c"] };
    expect(deepMerge(base, override)).toEqual({ plugins: ["c"] });
  });

  it("undefined values in override are skipped", () => {
    const base = { a: 1, b: 2 };
    const override = { a: undefined, b: 3 };
    expect(deepMerge(base, override)).toEqual({ a: 1, b: 3 });
  });

  it("null values in override replace base", () => {
    const base = { a: { x: 1 } };
    const override = { a: null };
    expect(deepMerge(base, override as any)).toEqual({ a: null });
  });

  it("handles empty base", () => {
    expect(deepMerge({}, { a: 1 })).toEqual({ a: 1 });
  });

  it("handles empty override", () => {
    expect(deepMerge({ a: 1 }, {})).toEqual({ a: 1 });
  });

  it("deep merges 3 levels", () => {
    const base = { a: { b: { c: 1, d: 2 } } };
    const override = { a: { b: { c: 3 } } };
    expect(deepMerge(base, override)).toEqual({ a: { b: { c: 3, d: 2 } } });
  });

  it("does not mutate base or override", () => {
    const base = { a: { x: 1 } };
    const override = { a: { y: 2 } };
    const baseCopy = JSON.parse(JSON.stringify(base));
    const overrideCopy = JSON.parse(JSON.stringify(override));
    deepMerge(base, override);
    expect(base).toEqual(baseCopy);
    expect(override).toEqual(overrideCopy);
  });
});

// ── loadConfig ──────────────────────────────────────────────

describe("loadConfig", () => {
  const FIXTURE_DIR = resolve(
    import.meta.dirname ?? ".",
    "__config_fixture__",
  );
  const globalDir = join(FIXTURE_DIR, "global-oni");
  const projectDir = join(FIXTURE_DIR, "project");

  function ensureClean() {
    if (existsSync(FIXTURE_DIR)) {
      rmSync(FIXTURE_DIR, { recursive: true, force: true });
    }
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
  }

  beforeEach(ensureClean);
  afterEach(() => {
    if (existsSync(FIXTURE_DIR)) {
      rmSync(FIXTURE_DIR, { recursive: true, force: true });
    }
  });

  it("returns empty config when no files exist", async () => {
    const config = await loadConfig({ globalDir, projectDir });
    expect(config).toEqual({});
  });

  it("loads global config", async () => {
    writeFileSync(
      join(globalDir, "config.jsonc"),
      '{\n  // Global config\n  "model": {"provider": "anthropic", "model": "claude-sonnet-4-20250514"}\n}',
    );
    const config = await loadConfig({ globalDir, projectDir });
    expect(config.model).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
    });
  });

  it("loads project config from oni.jsonc", async () => {
    writeFileSync(
      join(projectDir, "oni.jsonc"),
      '{"swarm": {"maxConcurrency": 8}}',
    );
    const config = await loadConfig({ globalDir, projectDir });
    expect(config.swarm).toEqual({ maxConcurrency: 8 });
  });

  it("loads project config from .oni/config.jsonc", async () => {
    const dotOni = join(projectDir, ".oni");
    mkdirSync(dotOni, { recursive: true });
    writeFileSync(
      join(dotOni, "config.jsonc"),
      '{"compaction": {"auto": false}}',
    );
    const config = await loadConfig({ globalDir, projectDir });
    expect(config.compaction).toEqual({ auto: false });
  });

  it("project config overrides global config", async () => {
    writeFileSync(
      join(globalDir, "config.jsonc"),
      '{"model": {"provider": "openai", "model": "gpt-4"}}',
    );
    writeFileSync(
      join(projectDir, "oni.jsonc"),
      '{"model": {"model": "gpt-4o"}}',
    );
    const config = await loadConfig({ globalDir, projectDir });
    expect(config.model).toEqual({ provider: "openai", model: "gpt-4o" });
  });

  it(".oni/config.jsonc overrides oni.jsonc", async () => {
    writeFileSync(
      join(projectDir, "oni.jsonc"),
      '{"swarm": {"poolSize": 4}}',
    );
    const dotOni = join(projectDir, ".oni");
    mkdirSync(dotOni, { recursive: true });
    writeFileSync(
      join(dotOni, "config.jsonc"),
      '{"swarm": {"poolSize": 8}}',
    );
    const config = await loadConfig({ globalDir, projectDir });
    expect(config.swarm!.poolSize).toBe(8);
  });

  it("inline config overrides all file configs", async () => {
    writeFileSync(
      join(globalDir, "config.jsonc"),
      '{"model": {"provider": "openai", "model": "gpt-4"}}',
    );
    const config = await loadConfig({
      globalDir,
      projectDir,
      inline: { model: { provider: "anthropic", model: "claude-opus-4-20250514" } },
    });
    expect(config.model).toEqual({
      provider: "anthropic",
      model: "claude-opus-4-20250514",
    });
  });

  it("merges agents from multiple levels", async () => {
    writeFileSync(
      join(globalDir, "config.jsonc"),
      '{"agents": {"build": {"maxSteps": 50}}}',
    );
    writeFileSync(
      join(projectDir, "oni.jsonc"),
      '{"agents": {"explore": {"maxSteps": 5, "tools": ["grep", "glob"]}}}',
    );
    const config = await loadConfig({ globalDir, projectDir });
    expect(config.agents!.build).toEqual({ maxSteps: 50 });
    expect(config.agents!.explore).toEqual({
      maxSteps: 5,
      tools: ["grep", "glob"],
    });
  });

  it("handles invalid JSONC in a file gracefully", async () => {
    writeFileSync(join(globalDir, "config.jsonc"), "{invalid json}");
    writeFileSync(
      join(projectDir, "oni.jsonc"),
      '{"model": {"provider": "test", "model": "test"}}',
    );
    // Should skip the invalid file and continue
    const config = await loadConfig({ globalDir, projectDir });
    expect(config.model).toEqual({ provider: "test", model: "test" });
  });

  it("handles permission rules in config", async () => {
    writeFileSync(
      join(projectDir, "oni.jsonc"),
      JSON.stringify({
        permissions: {
          read_file: "allow",
          bash: { "rm *": "deny", "npm *": "allow", "*": "ask" },
        },
      }),
    );
    const config = await loadConfig({ globalDir, projectDir });
    expect(config.permissions!.read_file).toBe("allow");
    expect(config.permissions!.bash).toEqual({
      "rm *": "deny",
      "npm *": "allow",
      "*": "ask",
    });
  });

  it("handles LSP config", async () => {
    writeFileSync(
      join(projectDir, "oni.jsonc"),
      JSON.stringify({
        lsp: {
          typescript: { command: "typescript-language-server", args: ["--stdio"] },
        },
      }),
    );
    const config = await loadConfig({ globalDir, projectDir });
    expect(config.lsp).toEqual({
      typescript: {
        command: "typescript-language-server",
        args: ["--stdio"],
      },
    });
  });

  it("lsp: false disables LSP entirely", async () => {
    writeFileSync(
      join(globalDir, "config.jsonc"),
      '{"lsp": {"typescript": {"command": "tsserver"}}}',
    );
    writeFileSync(join(projectDir, "oni.jsonc"), '{"lsp": false}');
    const config = await loadConfig({ globalDir, projectDir });
    expect(config.lsp).toBe(false);
  });
});
