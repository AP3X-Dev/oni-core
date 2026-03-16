import { describe, it, expect } from "vitest";
import { handleJsonRPC } from "../server/handler.js";
import { generateAgentCard } from "../card/generator.js";

describe("handleJsonRPC — tasks/sendSubscribe", () => {
  it("BUG-0001: should return JSON-RPC error when handler throws synchronously", async () => {
    const card = generateAgentCard({ name: "Test", description: "Test", url: "http://test" });

    const throwingHandler = () => {
      throw new Error("sync boom");
    };

    const result = await handleJsonRPC(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tasks/sendSubscribe",
        params: { id: "t1", message: { parts: [{ type: "text", text: "hi" }] } },
      },
      throwingHandler as any,
      card,
    );

    // Should return a well-formed JSON-RPC error, not throw
    expect(result.response).toBeDefined();
    const res = result.response as { jsonrpc: string; id: unknown; error: { code: number; message: string } };
    expect(res.jsonrpc).toBe("2.0");
    expect(res.id).toBe(1);
    expect(res.error.code).toBe(-32603);
    expect(res.error.message).toBe("sync boom");
  });
});
