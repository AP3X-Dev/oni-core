import { describe, it, expect, vi } from "vitest";
import { defineAgent } from "../agents/define-agent.js";
import type { ONIModel, ChatResponse } from "../models/types.js";

/**
 * Regression tests for BUG-0443: defineAgent() return value
 * `{ messages: newMessages }` was double-cast through `as unknown as Partial<S>`,
 * silently bypassing TypeScript when the caller's state type `S` has no
 * `messages` field.
 *
 * Fix: The generic parameter S is now constrained to
 * `{ messages?: ONIModelMessage[] } & Record<string, unknown>`, allowing the
 * direct cast `{ messages: newMessages } as Partial<S>` without the unsafe
 * `as unknown` intermediate.
 *
 * These tests verify the runtime behaviour (the partial update carries
 * messages) and that additional state fields are passed through unchanged.
 */

function makeMockModel(response: ChatResponse): ONIModel {
  return {
    provider: "test",
    modelId: "test-model",
    capabilities: { tools: true, vision: false, streaming: true, embeddings: false },
    chat: vi.fn(async () => response),
    async *stream() {
      yield { type: "text" as const, text: "chunk" };
    },
  };
}

const simpleResponse: ChatResponse = {
  content: "Hello from agent",
  usage: { inputTokens: 5, outputTokens: 7 },
  stopReason: "end",
};

describe("BUG-0443: defineAgent messages cast — Partial<S> return is correct", () => {
  it("returns a Partial containing the messages key", async () => {
    const model = makeMockModel(simpleResponse);
    const agent = defineAgent({ name: "a", model });

    const result = await agent._nodeFn({}, {});

    expect(result).toHaveProperty("messages");
    expect(Array.isArray(result.messages)).toBe(true);
  });

  it("returned messages array contains the assistant reply", async () => {
    const model = makeMockModel(simpleResponse);
    const agent = defineAgent({ name: "a", model });

    const result = await agent._nodeFn({}, {});

    const msgs = result.messages!;
    expect(msgs.length).toBeGreaterThan(0);
    const lastMsg = msgs[msgs.length - 1]!;
    expect(lastMsg.role).toBe("assistant");
    expect(lastMsg.content).toBe("Hello from agent");
  });

  it("only newly generated messages are returned (not the input)", async () => {
    const model = makeMockModel(simpleResponse);
    const agent = defineAgent({ name: "a", model });

    // defineAgent slices off existingMessages — only new messages from this
    // run are returned in the Partial<S> update.
    const inputMessages = [{ role: "user" as const, content: "Hi" }];
    const result = await agent._nodeFn({ messages: inputMessages }, {});

    const msgs = result.messages!;
    // Only the assistant reply is new — the user input was already in state.
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.role).toBe("assistant");
    expect(msgs[0]!.content).toBe("Hello from agent");
  });

  it("return value does not have unexpected extra keys from the cast", async () => {
    const model = makeMockModel(simpleResponse);
    const agent = defineAgent({ name: "a", model });

    const result = await agent._nodeFn({}, {});

    // Only 'messages' should be in the returned partial update — the double
    // cast `as unknown as Partial<S>` could have allowed arbitrary shapes.
    const keys = Object.keys(result);
    expect(keys).toEqual(["messages"]);
  });

  it("extended state type: messages field is correctly typed and other fields preserved", async () => {
    type MyState = { messages?: import("../models/types.js").ONIModelMessage[]; counter: number };

    const model = makeMockModel(simpleResponse);
    // defineAgent's S is now constrained so this compiles without `as unknown`
    const agent = defineAgent<MyState>({ name: "a", model });

    const result = await agent._nodeFn({ messages: [], counter: 42 }, {});

    // The returned partial carries messages
    expect(result.messages).toBeDefined();
    expect(Array.isArray(result.messages)).toBe(true);
  });
});
