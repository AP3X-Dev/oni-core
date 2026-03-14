import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "os";
import * as fsSync from "fs";
import * as pathSync from "path";
import type { ChatResponse } from "../models/types.js";
import type { AgentLoopConfig, LoopMessage } from "../harness/types.js";
import { agentLoop } from "../harness/agent-loop.js";
import { MemoryLoader } from "../harness/memory-loader.js";

// ─── Helpers ───────────────────────────────────────────────────────────────

function textResponse(content: string): ChatResponse {
  return { content, usage: { inputTokens: 10, outputTokens: 10 }, stopReason: "end" };
}

function createMockModel(responses: ChatResponse[]) {
  let i = 0;
  return {
    chat: vi.fn(async () => responses[i++] ?? responses[responses.length - 1]!),
    stream: vi.fn(),
    provider: "mock" as const,
    modelId: "mock",
    capabilities: { tools: true, vision: false, streaming: false, embeddings: false },
  };
}

async function collectMessages(gen: AsyncGenerator<LoopMessage>): Promise<LoopMessage[]> {
  const msgs: LoopMessage[] = [];
  for await (const msg of gen) msgs.push(msg);
  return msgs;
}

function baseConfig(overrides: Partial<AgentLoopConfig> = {}): AgentLoopConfig {
  return {
    model: createMockModel([textResponse("Done.")]),
    tools: [],
    agentName: "test-agent",
    systemPrompt: "You are a test agent.",
    maxTurns: 10,
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("agentLoop — memory integration", () => {
  let tmpDir: string;
  let fromRootSpy: ReturnType<typeof vi.spyOn>;
  let mockLoader: {
    wake: ReturnType<typeof vi.fn>;
    orient: ReturnType<typeof vi.fn>;
    match: ReturnType<typeof vi.fn>;
    buildSystemPrompt: ReturnType<typeof vi.fn>;
    getQueryTool: ReturnType<typeof vi.fn>;
    persistEpisodic: ReturnType<typeof vi.fn>;
    resetSession: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    tmpDir = fsSync.mkdtempSync(pathSync.join(os.tmpdir(), "oni-loop-mem-"));

    mockLoader = {
      wake: vi.fn(() => ({ units: [], totalTokens: 0, budget: 800, dropped: [] })),
      orient: vi.fn(() => ({ units: [], totalTokens: 0, budget: 2000, dropped: [] })),
      match: vi.fn(() => ({ units: [], totalTokens: 0, budget: 4000, dropped: [] })),
      buildSystemPrompt: vi.fn(() => "<!-- MEMORY: T0+T1+T2 -->"),
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
    };

    fromRootSpy = vi
      .spyOn(MemoryLoader, "fromRoot")
      .mockReturnValue(mockLoader as unknown as MemoryLoader);
  });

  afterEach(() => {
    fromRootSpy.mockRestore();
    fsSync.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Session init ──────────────────────────────────────────────────────────

  it("calls fromRoot with config.memoryRoot when memoryRoot is set", async () => {
    const config = baseConfig({ memoryRoot: tmpDir });
    await collectMessages(agentLoop("test prompt", config));
    expect(MemoryLoader.fromRoot).toHaveBeenCalledWith(tmpDir, expect.objectContaining({}));
  });

  it("calls wake(), orient(), match(prompt) in order before first model call", async () => {
    const model = createMockModel([textResponse("Done.")]);
    const config = baseConfig({ model, memoryRoot: tmpDir });
    const callOrder: string[] = [];

    mockLoader.wake.mockImplementation(() => {
      callOrder.push("wake");
      return { units: [], totalTokens: 0, budget: 800, dropped: [] };
    });
    mockLoader.orient.mockImplementation(() => {
      callOrder.push("orient");
      return { units: [], totalTokens: 0, budget: 2000, dropped: [] };
    });
    mockLoader.match.mockImplementation(() => {
      callOrder.push("match");
      return { units: [], totalTokens: 0, budget: 4000, dropped: [] };
    });
    (model.chat as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push("model");
      return textResponse("Done.");
    });

    await collectMessages(agentLoop("my task", config));

    const wakeIdx = callOrder.indexOf("wake");
    const orientIdx = callOrder.indexOf("orient");
    const matchIdx = callOrder.indexOf("match");
    const modelIdx = callOrder.indexOf("model");

    expect(wakeIdx).toBeLessThan(orientIdx);
    expect(orientIdx).toBeLessThan(matchIdx);
    expect(matchIdx).toBeLessThan(modelIdx);
  });

  it("match() is called with the user prompt string", async () => {
    const config = baseConfig({ memoryRoot: tmpDir });
    await collectMessages(agentLoop("specific task description", config));
    expect(mockLoader.match).toHaveBeenCalledWith("specific task description");
  });

  it("effectiveSystemPrompt prepends memory context before soul", async () => {
    mockLoader.buildSystemPrompt.mockReturnValue("<!-- MEMORY CONTEXT -->");
    const model = createMockModel([textResponse("Done.")]);
    const config = baseConfig({
      model,
      memoryRoot: tmpDir,
      systemPrompt: "You are a soul.",
    });

    await collectMessages(agentLoop("task", config));

    const chatCall = (model.chat as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(chatCall?.systemPrompt).toContain("<!-- MEMORY CONTEXT -->");
    expect(chatCall?.systemPrompt).toContain("You are a soul.");
    // Memory context should come first
    const memIdx = chatCall?.systemPrompt?.indexOf("<!-- MEMORY CONTEXT -->");
    const soulIdx = chatCall?.systemPrompt?.indexOf("You are a soul.");
    expect(memIdx).toBeLessThan(soulIdx);
  });

  it("memory_query is included in tools sent to model", async () => {
    const model = createMockModel([textResponse("Done.")]);
    const config = baseConfig({ model, memoryRoot: tmpDir });

    await collectMessages(agentLoop("task", config));

    const chatCall = (model.chat as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    const toolNames = chatCall?.tools?.map((t: { name: string }) => t.name) ?? [];
    expect(toolNames).toContain("memory_query");
  });

  // ── Session end ───────────────────────────────────────────────────────────

  it("calls persistEpisodic() then resetSession() on clean exit", async () => {
    const config = baseConfig({ memoryRoot: tmpDir });
    await collectMessages(agentLoop("task", config));
    expect(mockLoader.persistEpisodic).toHaveBeenCalledOnce();
    expect(mockLoader.resetSession).toHaveBeenCalledOnce();
    // persistEpisodic should be called before resetSession
    const persistOrder = mockLoader.persistEpisodic.mock.invocationCallOrder[0];
    const resetOrder = mockLoader.resetSession.mock.invocationCallOrder[0];
    expect(persistOrder).toBeLessThan(resetOrder!);
  });

  it("episodic log content includes 'completed' outcome on clean exit", async () => {
    const config = baseConfig({ memoryRoot: tmpDir });
    await collectMessages(agentLoop("task", config));
    const logContent: string = mockLoader.persistEpisodic.mock.calls[0]?.[1];
    expect(logContent).toContain("outcome: completed");
  });

  it("calls persistEpisodic() and resetSession() on error exit (finally runs)", async () => {
    const model = createMockModel([]);
    (model.chat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("inference exploded"));
    const config = baseConfig({ model, memoryRoot: tmpDir });
    await collectMessages(agentLoop("task", config));
    expect(mockLoader.persistEpisodic).toHaveBeenCalledOnce();
    expect(mockLoader.resetSession).toHaveBeenCalledOnce();
    const logContent: string = mockLoader.persistEpisodic.mock.calls[0]?.[1];
    expect(logContent).toContain("outcome: error");
  });

  it("calls persistEpisodic() and resetSession() on abort (finally runs)", async () => {
    const controller = new AbortController();
    controller.abort();
    const config = baseConfig({ memoryRoot: tmpDir, signal: controller.signal });
    await collectMessages(agentLoop("task", config));
    expect(mockLoader.persistEpisodic).toHaveBeenCalledOnce();
    expect(mockLoader.resetSession).toHaveBeenCalledOnce();
    const logContent: string = mockLoader.persistEpisodic.mock.calls[0]?.[1];
    expect(logContent).toContain("outcome: interrupted");
  });

  it("memory_query is not in config.tools after loop (config.tools never mutated)", async () => {
    // Invariant: allTools adds memory_query at runtime; config.tools is never modified.
    // If this were violated, SessionStart hooks would incorrectly receive memory_query.
    const tools: import("../tools/types.js").ToolDefinition[] = [];
    const config = baseConfig({ memoryRoot: tmpDir, tools });
    await collectMessages(agentLoop("task", config));
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).not.toContain("memory_query");
  });

  it("sessionOutcome is 'budget-exceeded' when maxTurns exhausted", async () => {
    // Model always returns a tool call the loop can't finish — never reaches END
    const neverEndingModel = {
      ...createMockModel([]),
      chat: vi.fn(async () => ({
        content: "using tool",
        toolCalls: [{ id: "tc_1", name: "NoSuchTool", args: {} }],
        usage: { inputTokens: 10, outputTokens: 10 },
        stopReason: "tool_use" as const,
      })),
    };
    const config = baseConfig({ model: neverEndingModel, memoryRoot: tmpDir, maxTurns: 2 });
    await collectMessages(agentLoop("task", config));
    const logContent: string = mockLoader.persistEpisodic.mock.calls[0]?.[1];
    expect(logContent).toContain("outcome: budget-exceeded");
    expect(logContent).toContain("may be incomplete");
  });

  // ── No-memory path ────────────────────────────────────────────────────────

  it("no-memory path: loop runs cleanly without memoryRoot", async () => {
    const config = baseConfig(); // no memoryRoot
    await expect(collectMessages(agentLoop("task", config))).resolves.toBeDefined();
    expect(MemoryLoader.fromRoot).not.toHaveBeenCalled();
  });

  it("no-memory path: persistEpisodic is never called", async () => {
    const config = baseConfig();
    await collectMessages(agentLoop("task", config));
    expect(mockLoader.persistEpisodic).not.toHaveBeenCalled();
  });

  it("no-memory path: memory_query not in tool list", async () => {
    const model = createMockModel([textResponse("Done.")]);
    const config = baseConfig({ model }); // no memoryRoot
    await collectMessages(agentLoop("task", config));
    const chatCall = (model.chat as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    const toolNames = chatCall?.tools?.map((t: { name: string }) => t.name) ?? [];
    expect(toolNames).not.toContain("memory_query");
  });
});
