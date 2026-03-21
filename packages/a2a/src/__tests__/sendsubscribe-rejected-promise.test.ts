/**
 * Regression test for BUG-0361
 *
 * `handler()` for tasks/sendSubscribe was not awaited before checking
 * [Symbol.asyncIterator]. If handler() returns a rejected Promise instead of
 * throwing synchronously, the rejection bypassed the surrounding try/catch and
 * surfaced as an unhandled rejection rather than a well-formed JSON-RPC error.
 *
 * Fix: await handler(messageText, taskId) so rejected Promises are caught by
 * the existing try/catch block. Landed in commit ada9de7 on main.
 */
import { describe, it, expect } from "vitest";
import { handleJsonRPC } from "../server/handler.js";
import { generateAgentCard } from "../card/generator.js";

describe("BUG-0361: tasks/sendSubscribe — rejected Promise must be caught as JSON-RPC error", () => {
  it("returns a JSON-RPC error when handler returns a rejected Promise", async () => {
    const card = generateAgentCard({
      name: "Test",
      description: "Test",
      url: "http://test",
      streaming: true,
    });

    // A handler that returns a Promise.reject() rather than throwing synchronously.
    // Before the fix, the rejection was not caught — handler() was called without
    // await, so the rejected promise was never observed by the try/catch.
    const rejectingHandler = () => Promise.reject(new Error("async rejection"));

    const result = await handleJsonRPC(
      {
        jsonrpc: "2.0",
        id: 42,
        method: "tasks/sendSubscribe",
        params: { id: "t1", message: { parts: [{ type: "text", text: "hello" }] } },
      },
      rejectingHandler as any,
      card,
    );

    // Must return a well-formed JSON-RPC error response, not propagate the rejection
    expect(result.response).toBeDefined();
    expect(result.stream).toBeUndefined();

    const res = result.response as {
      jsonrpc: string;
      id: unknown;
      error: { code: number; message: string };
    };
    expect(res.jsonrpc).toBe("2.0");
    expect(res.id).toBe(42);
    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(-32603);
  });

  it("still returns a stream when handler returns a valid async generator", async () => {
    const card = generateAgentCard({
      name: "Test",
      description: "Test",
      url: "http://test",
      streaming: true,
    });

    async function* validHandler(): AsyncGenerator<string> {
      yield "chunk-1";
      yield "chunk-2";
    }

    const result = await handleJsonRPC(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tasks/sendSubscribe",
        params: { id: "t2", message: { parts: [{ type: "text", text: "hi" }] } },
      },
      validHandler as any,
      card,
    );

    expect(result.stream).toBeDefined();
    expect(result.response).toBeUndefined();

    const chunks: string[] = [];
    for await (const chunk of result.stream!) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(["chunk-1", "chunk-2"]);
  });
});
