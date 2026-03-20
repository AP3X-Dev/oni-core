import { describe, it, expect, vi } from "vitest";
import { adaptActivePiece } from "../adapter/index.js";
import type { ActivePiecesAction, AdaptedToolDefinition } from "../adapter/index.js";

// BUG-0283: adaptActivePiece().execute() passed the raw LLM-supplied `input`
// object directly to `action.run({ propsValue: input })` without stripping
// prototype-polluting keys (__proto__, constructor, prototype).
// Fix: sanitizeInput() is applied to input before forwarding to action.run().

function makeAction(
  capturedProps: { value?: Record<string, unknown> } = {},
): ActivePiecesAction {
  return {
    name: "test_action",
    displayName: "Test Action",
    description: "A test action",
    props: {},
    run: async (ctx) => {
      capturedProps.value = ctx.propsValue;
      return { ok: true };
    },
  };
}

const noopAuthResolver = {
  resolve: async (_auth: unknown, _ctx: unknown) => ({}),
};

describe("BUG-0283: adaptActivePiece() strips prototype-polluting keys", () => {
  it("BUG-0283: __proto__ key is stripped from input before action.run()", async () => {
    const captured: { value?: Record<string, unknown> } = {};
    const tool: AdaptedToolDefinition = adaptActivePiece(makeAction(captured), noopAuthResolver);

    // JSON.parse-based injection: __proto__ as an own enumerable key
    // (as produced by JSON.parse('{"__proto__":{"injected":true}}'))
    const maliciousInput = JSON.parse('{"safe":"value","__proto__":{"injected":true}}') as Record<string, unknown>;

    await tool.execute(maliciousInput, null);

    expect(captured.value).toBeDefined();
    expect(captured.value!["safe"]).toBe("value");
    // __proto__ own key must not appear in the sanitized output
    expect(Object.prototype.hasOwnProperty.call(captured.value, "__proto__")).toBe(false);
    // Prototype must not have been polluted
    expect(Object.prototype).not.toHaveProperty("injected");
  });

  it("BUG-0283: constructor key is stripped from input before action.run()", async () => {
    const captured: { value?: Record<string, unknown> } = {};
    const tool: AdaptedToolDefinition = adaptActivePiece(makeAction(captured), noopAuthResolver);

    const input: Record<string, unknown> = {
      normal: "data",
      constructor: { polluted: true },
    };

    await tool.execute(input, null);

    expect(captured.value).toBeDefined();
    expect(captured.value!["normal"]).toBe("data");
    // The dangerous key should have been removed — check own properties only
    expect(Object.prototype.hasOwnProperty.call(captured.value, "constructor")).toBe(false);
  });

  it("BUG-0283: prototype key is stripped from input before action.run()", async () => {
    const captured: { value?: Record<string, unknown> } = {};
    const tool: AdaptedToolDefinition = adaptActivePiece(makeAction(captured), noopAuthResolver);

    const input: Record<string, unknown> = {
      data: "ok",
      prototype: { evil: true },
    };

    await tool.execute(input, null);

    expect(captured.value!["data"]).toBe("ok");
    expect(captured.value!["prototype"]).toBeUndefined();
  });

  it("BUG-0283: strips dangerous keys recursively in nested objects", async () => {
    const captured: { value?: Record<string, unknown> } = {};
    const tool: AdaptedToolDefinition = adaptActivePiece(makeAction(captured), noopAuthResolver);

    const input: Record<string, unknown> = {
      config: {
        valid: "yes",
        constructor: { nested: "attack" },
      },
    };

    await tool.execute(input, null);

    const nested = captured.value!["config"] as Record<string, unknown>;
    expect(nested["valid"]).toBe("yes");
    // Dangerous keys should be stripped from nested objects too
    expect(Object.prototype.hasOwnProperty.call(nested, "constructor")).toBe(false);
  });

  it("BUG-0283: safe keys pass through unchanged", async () => {
    const captured: { value?: Record<string, unknown> } = {};
    const tool: AdaptedToolDefinition = adaptActivePiece(makeAction(captured), noopAuthResolver);

    const input: Record<string, unknown> = {
      name: "Alice",
      count: 42,
      tags: ["a", "b"],
    };

    await tool.execute(input, null);

    expect(captured.value!["name"]).toBe("Alice");
    expect(captured.value!["count"]).toBe(42);
    expect(captured.value!["tags"]).toEqual(["a", "b"]);
  });
});
