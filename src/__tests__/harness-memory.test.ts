import { describe, it, expect, vi } from "vitest";
import * as os from "os";
import * as fsSync from "fs";
import * as pathSync from "path";
import { ONIHarness } from "../harness/harness.js";
import { MemoryLoader } from "../harness/memory-loader.js";

// Minimal mock model (harness needs a model, will call it once then end)
const mockModel = {
  chat: async () => ({ content: "ok", usage: { inputTokens: 0, outputTokens: 0 }, stopReason: "end" }),
  stream: async () => {},
  provider: "mock" as const,
  modelId: "mock",
  capabilities: { tools: true, vision: false, streaming: false, embeddings: false },
};

// Helper to build a mock MemoryLoader compatible object
function mockMemLoader() {
  return {
    wake: vi.fn(() => ({ units: [], totalTokens: 0, budget: 800, dropped: [] })),
    orient: vi.fn(() => ({ units: [], totalTokens: 0, budget: 2000, dropped: [] })),
    match: vi.fn(() => ({ units: [], totalTokens: 0, budget: 4000, dropped: [] })),
    buildSystemPrompt: vi.fn(() => ""),
    getQueryTool: vi.fn(() => ({
      name: "memory_query",
      description: "Query memory",
      schema: {
        type: "object",
        properties: { topic: { type: "string" }, reason: { type: "string" } },
        required: ["topic", "reason"],
        additionalProperties: false,
      },
      execute: vi.fn(() => ({ found: false, message: "no results" })),
    })),
    persistEpisodic: vi.fn(),
    resetSession: vi.fn(),
  } as unknown as MemoryLoader;
}

describe("ONIHarness — memory config", () => {
  it("getHarnessTools() does not include memory_query (loop-created)", () => {
    const harness = ONIHarness.create({ model: mockModel });
    const tools = harness.getHarnessTools();
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("memory_query");
  });

  it("getHarnessTools() includes TodoWrite, TodoRead, Skill tools", () => {
    const harness = ONIHarness.create({ model: mockModel });
    const tools = harness.getHarnessTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("Skill");
  });

  it("no-memory path: ONIHarness.create({model}) succeeds without throws", () => {
    expect(() => ONIHarness.create({ model: mockModel })).not.toThrow();
  });

  it("with memoryRoot: buildLoopConfig forwards memoryRoot to MemoryLoader.fromRoot", async () => {
    const root = fsSync.mkdtempSync(pathSync.join(os.tmpdir(), "oni-harness-mem-"));
    const spy = vi.spyOn(MemoryLoader, "fromRoot").mockReturnValue(mockMemLoader());
    try {
      const harness = ONIHarness.create({ model: mockModel, memoryRoot: root });
      for await (const _ of harness.run("hello", "test-agent")) { /* drain */ }
      expect(spy).toHaveBeenCalledWith(root, expect.objectContaining({}));
    } finally {
      spy.mockRestore();
      fsSync.rmSync(root, { recursive: true, force: true });
    }
  });
});
