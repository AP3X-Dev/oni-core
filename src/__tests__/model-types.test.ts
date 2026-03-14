import { describe, it, expect } from "vitest";
import type {
  ONIModel,
  ChatParams,
  ChatResponse,
  ChatChunk,
} from "../models/index.js";

describe("ONIModel interface", () => {
  it("ONIModel interface is structurally valid", async () => {
    const mockModel: ONIModel = {
      provider: "mock",
      modelId: "mock-v1",
      capabilities: {
        tools: true,
        vision: false,
        streaming: true,
        embeddings: false,
      },
      async chat(_params: ChatParams): Promise<ChatResponse> {
        return {
          content: "hello",
          usage: { inputTokens: 10, outputTokens: 5 },
          stopReason: "end",
        };
      },
      async *stream(_params: ChatParams): AsyncGenerator<ChatChunk> {
        yield { type: "text", text: "hello" };
      },
    };

    expect(mockModel.provider).toBe("mock");
    expect(mockModel.modelId).toBe("mock-v1");
    expect(mockModel.capabilities.tools).toBe(true);
    expect(mockModel.capabilities.vision).toBe(false);
    expect(mockModel.capabilities.streaming).toBe(true);
    expect(mockModel.capabilities.embeddings).toBe(false);
  });

  it("ChatResponse includes usage for cost tracking", async () => {
    const mockModel: ONIModel = {
      provider: "test",
      modelId: "test-v1",
      capabilities: {
        tools: false,
        vision: false,
        streaming: false,
        embeddings: false,
      },
      async chat(_params: ChatParams): Promise<ChatResponse> {
        return {
          content: "response",
          usage: { inputTokens: 100, outputTokens: 50 },
          stopReason: "end",
        };
      },
      async *stream(): AsyncGenerator<ChatChunk> {
        yield { type: "text", text: "" };
      },
    };

    const response = await mockModel.chat({
      messages: [{ role: "user", content: "hi" }],
    });

    expect(response.usage).toBeDefined();
    expect(response.usage.inputTokens).toBe(100);
    expect(response.usage.outputTokens).toBe(50);
    expect(response.stopReason).toBe("end");
  });

  it("embed is optional on ONIModel", async () => {
    const mockModelWithEmbed: ONIModel = {
      provider: "embed-provider",
      modelId: "embed-v1",
      capabilities: {
        tools: false,
        vision: false,
        streaming: false,
        embeddings: true,
      },
      async chat(_params: ChatParams): Promise<ChatResponse> {
        return {
          content: "",
          usage: { inputTokens: 0, outputTokens: 0 },
          stopReason: "end",
        };
      },
      async *stream(): AsyncGenerator<ChatChunk> {
        yield { type: "text", text: "" };
      },
      async embed(texts: string[]): Promise<number[][]> {
        return texts.map(() => [0.1, 0.2, 0.3]);
      },
    };

    expect(mockModelWithEmbed.embed).toBeDefined();
    const embeddings = await mockModelWithEmbed.embed!(["hello", "world"]);
    expect(embeddings).toHaveLength(2);
    expect(embeddings[0]).toEqual([0.1, 0.2, 0.3]);
  });
});
