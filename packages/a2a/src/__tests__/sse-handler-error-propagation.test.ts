import { describe, it, expect } from "vitest";
import { handleJsonRPC } from "../server/handler.js";
import { createSSEResponse } from "../server/sse.js";
import { generateAgentCard } from "../card/generator.js";

describe("SSE stream error propagation", () => {
  it("BUG-0054: handler generator errors produce a JSON-RPC error SSE event, not a 'working' state frame", async () => {
    const card = generateAgentCard({
      name: "Test",
      description: "Test",
      url: "http://test",
      streaming: true,
    });

    // A streaming handler that yields one chunk then throws
    const throwingStreamingHandler = async function* () {
      yield "partial output";
      throw new Error("boom mid-stream");
    };

    const result = await handleJsonRPC(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tasks/sendSubscribe",
        params: { id: "t1", message: { parts: [{ type: "text", text: "go" }] } },
      },
      throwingStreamingHandler as unknown as Parameters<typeof handleJsonRPC>[1],
      card,
    );

    // The result must have a stream (not an inline error response)
    expect(result.stream).toBeDefined();
    expect(result.taskId).toBeDefined();

    // Consume the SSE response through createSSEResponse, collecting all frames
    const sseResponse = createSSEResponse(result.stream!, result.taskId!);
    const reader = sseResponse.body!.getReader();
    const decoder = new TextDecoder();
    const frames: string[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        frames.push(decoder.decode(value));
      }
    } catch {
      // The stream errors after emitting the JSON-RPC error frame;
      // controller.error() causes the read loop to throw. That's expected.
    }

    const allSSE = frames.join("");

    // Before the fix: safeStream caught the error and yielded it as a text string,
    // so it appeared as a "working" state frame and the stream ended with "completed".
    // After the fix: the error propagates to createSSEResponse's catch block,
    // which emits a JSON-RPC error event with code -32603.
    expect(allSSE).toContain('"code":-32603');

    // The stream must NOT end with a "completed" state after an error
    const lastDataFrame = allSSE.split("data: ").filter(Boolean).pop() ?? "";
    expect(lastDataFrame).not.toContain('"state":"completed"');

    // The error frame must not be disguised as a "working" status chunk
    // (i.e., the error JSON should appear in an error-keyed object, not in status.message.parts)
    expect(allSSE).toContain('"error"');
    expect(allSSE).not.toMatch(/"state":"working"[^}]*"boom mid-stream"/);
  });
});
