import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SafetyGate,
} from "../harness/safety-gate.js";
import type { ONIModel, ChatResponse } from "../models/types.js";

function createMockModel(overrides?: {
  chatResponse?: Partial<ChatResponse>;
  chatImpl?: (...args: unknown[]) => Promise<ChatResponse>;
}): ONIModel {
  const defaultResponse: ChatResponse = {
    content: JSON.stringify({ approved: true, reason: "Looks safe" }),
    usage: { inputTokens: 50, outputTokens: 30 },
    stopReason: "end",
  };

  return {
    chat: overrides?.chatImpl
      ? (vi.fn(overrides.chatImpl) as unknown as ONIModel["chat"])
      : (vi.fn().mockResolvedValue({
          ...defaultResponse,
          ...overrides?.chatResponse,
        }) as unknown as ONIModel["chat"]),
    stream: vi.fn() as unknown as ONIModel["stream"],
    provider: "mock",
    modelId: "mock-safety",
    capabilities: { tools: false, vision: false, streaming: false, embeddings: false },
  };
}

describe("SafetyGate", () => {
  let gate: SafetyGate;
  let model: ONIModel;

  beforeEach(() => {
    model = createMockModel();
    gate = new SafetyGate({ safetyModel: model });
  });

  // ── 1. requiresCheck() returns true for default protected tools ────

  it("requiresCheck() returns true for default protected tools", () => {
    expect(gate.requiresCheck("Bash")).toBe(true);
    expect(gate.requiresCheck("Write")).toBe(true);
    expect(gate.requiresCheck("MultiEdit")).toBe(true);
  });

  // ── 2. requiresCheck() returns false for non-protected tools ───────

  it("requiresCheck() returns false for non-protected tools", () => {
    expect(gate.requiresCheck("Read")).toBe(false);
    expect(gate.requiresCheck("Glob")).toBe(false);
    expect(gate.requiresCheck("Grep")).toBe(false);
  });

  // ── 3. requiresCheck() uses custom protected tools list ────────────

  it("requiresCheck() uses custom protected tools list", () => {
    const customGate = new SafetyGate({
      safetyModel: model,
      protectedTools: ["Deploy", "Delete"],
    });

    expect(customGate.requiresCheck("Deploy")).toBe(true);
    expect(customGate.requiresCheck("Delete")).toBe(true);
    expect(customGate.requiresCheck("Bash")).toBe(false);
    expect(customGate.requiresCheck("Write")).toBe(false);
  });

  // ── 4. check() returns approved when model approves ────────────────

  it("check() returns approved when model approves", async () => {
    const approveModel = createMockModel({
      chatResponse: {
        content: JSON.stringify({
          approved: true,
          reason: "Command is safe",
          riskScore: 0.1,
        }),
      },
    });
    const approveGate = new SafetyGate({ safetyModel: approveModel });

    const result = await approveGate.check({
      id: "call_1",
      name: "Bash",
      args: { command: "git status" },
    });

    expect(result.approved).toBe(true);
    expect(result.reason).toBe("Command is safe");
    expect(result.riskScore).toBe(0.1);
  });

  // ── 5. check() returns denied when model denies ────────────────────

  it("check() returns denied when model denies", async () => {
    const denyModel = createMockModel({
      chatResponse: {
        content: JSON.stringify({
          approved: false,
          reason: "Destructive command detected",
          riskScore: 0.95,
          suggestion: "Use a more targeted rm command",
        }),
      },
    });
    const denyGate = new SafetyGate({ safetyModel: denyModel });

    const result = await denyGate.check({
      id: "call_2",
      name: "Bash",
      args: { command: "rm -rf /" },
    });

    expect(result.approved).toBe(false);
    expect(result.reason).toBe("Destructive command detected");
    expect(result.riskScore).toBe(0.95);
    expect(result.suggestion).toBe("Use a more targeted rm command");
  });

  // ── 6. check() fails closed on timeout ─────────────────────────────

  it("check() fails closed on timeout (blocks destructive tools)", async () => {
    const slowModel = createMockModel({
      chatImpl: () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                content: JSON.stringify({ approved: false }),
                usage: { inputTokens: 0, outputTokens: 0 },
                stopReason: "end",
              }),
            10_000,
          ),
        ),
    });
    const timeoutGate = new SafetyGate({
      safetyModel: slowModel,
      timeout: 50,
    });

    const result = await timeoutGate.check({
      id: "call_3",
      name: "Bash",
      args: { command: "echo hello" },
    });

    expect(result.approved).toBe(false);
    expect(result.reason).toBe("Safety check unavailable (timeout/error) — failing closed");
    expect(result.riskScore).toBe(1.0);
  });

  // ── 7. check() defaults to approved on parse error ─────────────────

  it("check() fails closed on parse error (does not silently approve)", async () => {
    const badModel = createMockModel({
      chatResponse: {
        content: "this is not valid JSON at all {{{",
      },
    });
    const badGate = new SafetyGate({ safetyModel: badModel });

    const result = await badGate.check({
      id: "call_4",
      name: "Write",
      args: { file_path: "/tmp/test.txt", content: "hello" },
    });

    expect(result.approved).toBe(false);
    expect(result.reason).toBe("Safety check failed: model returned non-JSON response");
    expect(result.riskScore).toBe(1.0);
  });

  // ── 8. check() passes tool call info to the safety model ───────────

  it("check() passes tool call info to the safety model", async () => {
    await gate.check({
      id: "call_5",
      name: "Bash",
      args: { command: "ls -la" },
    });

    expect(model.chat).toHaveBeenCalledOnce();
    const chatArgs = (model.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(chatArgs.messages).toHaveLength(1);
    expect(chatArgs.messages[0].role).toBe("user");
    expect(chatArgs.messages[0].content).toContain("Bash");
    expect(chatArgs.messages[0].content).toContain("ls -la");
    expect(chatArgs.maxTokens).toBe(256);
    expect(chatArgs.systemPrompt).toBeDefined();
  });

  // ── 9. check() fails closed when model throws ──────────────────────

  it("check() fails closed when model throws (blocks destructive tools)", async () => {
    const errorModel = createMockModel({
      chatImpl: () => Promise.reject(new Error("API error")),
    });
    const errorGate = new SafetyGate({ safetyModel: errorModel });

    const result = await errorGate.check({
      id: "call_6",
      name: "Bash",
      args: { command: "echo test" },
    });

    expect(result.approved).toBe(false);
    expect(result.reason).toBe("Safety check unavailable (timeout/error) — failing closed");
    expect(result.riskScore).toBe(1.0);
  });

  // ── 10. custom safety system prompt is used ────────────────────────

  it("custom safety system prompt is used", async () => {
    const customPrompt = "You are a custom safety checker.";
    const customGate = new SafetyGate({
      safetyModel: model,
      safetySystemPrompt: customPrompt,
    });

    await customGate.check({
      id: "call_7",
      name: "Bash",
      args: { command: "echo hi" },
    });

    const chatArgs = (model.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(chatArgs.systemPrompt).toBe(customPrompt);
  });
});
