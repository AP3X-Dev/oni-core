import { describe, it, expect, vi } from "vitest";
import { adaptActivePiece } from "../adapter/index.js";
import { apiKeyAuthResolver } from "../adapter/auth-resolver.js";
import { PropertyType } from "../adapter/props-to-schema.js";

// BUG-0283: adaptActivePiece.execute() passes the raw LLM-supplied input object
// directly to action.run({ propsValue: input }) without stripping prototype-polluting
// keys (__proto__, constructor, prototype). An LLM-supplied payload such as
// { "__proto__": { "isAdmin": true } } reaches action.run() unfiltered, potentially
// causing prototype pollution if the integration piece uses Object.assign or spread.
//
// This test verifies that the execute() function strips dangerous keys before
// forwarding to action.run(). It will FAIL until BUG-0283 is fixed.

function makeAction(spy: ReturnType<typeof vi.fn>) {
  return {
    name: "send_message",
    displayName: "Send Message",
    description: "Send a message",
    props: {
      text: { type: PropertyType.SHORT_TEXT, displayName: "Text", required: true },
    },
    run: spy,
  };
}

describe("BUG-0283: adaptActivePiece strips prototype-polluting keys from input", () => {
  it("BUG-0283: strips __proto__ key before forwarding to action.run()", async () => {
    const runSpy = vi.fn().mockResolvedValue({ ok: true });
    const tool = adaptActivePiece(makeAction(runSpy), apiKeyAuthResolver(() => "key"));

    // Simulate LLM-supplied input containing __proto__ pollution attempt
    const maliciousInput = Object.create(null) as Record<string, unknown>;
    maliciousInput.text = "hello";
    // Using defineProperty to set __proto__ as an own property (not prototype assignment)
    Object.defineProperty(maliciousInput, "__proto__", {
      value: { isAdmin: true },
      enumerable: true,
      configurable: true,
      writable: true,
    });

    await tool.execute(maliciousInput, {});

    const passedProps = runSpy.mock.calls[0][0].propsValue as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(passedProps, "__proto__")).toBe(false);
    expect(passedProps.text).toBe("hello");
  });

  it("BUG-0283: strips constructor key before forwarding to action.run()", async () => {
    const runSpy = vi.fn().mockResolvedValue({ ok: true });
    const tool = adaptActivePiece(makeAction(runSpy), apiKeyAuthResolver(() => "key"));

    const input: Record<string, unknown> = {
      text: "world",
      constructor: { prototype: { isAdmin: true } },
    };

    await tool.execute(input, {});

    const passedProps = runSpy.mock.calls[0][0].propsValue as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(passedProps, "constructor")).toBe(false);
    expect(passedProps.text).toBe("world");
  });

  it("BUG-0283: strips prototype key before forwarding to action.run()", async () => {
    const runSpy = vi.fn().mockResolvedValue({ ok: true });
    const tool = adaptActivePiece(makeAction(runSpy), apiKeyAuthResolver(() => "key"));

    const input: Record<string, unknown> = {
      text: "value",
      prototype: { polluted: true },
    };

    await tool.execute(input, {});

    const passedProps = runSpy.mock.calls[0][0].propsValue as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(passedProps, "prototype")).toBe(false);
    expect(passedProps.text).toBe("value");
  });

  it("BUG-0283: preserves legitimate input keys while stripping dangerous ones", async () => {
    const runSpy = vi.fn().mockResolvedValue({ ok: true });
    const tool = adaptActivePiece(makeAction(runSpy), apiKeyAuthResolver(() => "key"));

    const input: Record<string, unknown> = {
      text: "hello",
      count: 42,
      __proto__: { evil: true },
      constructor: { bad: true },
      prototype: { ugly: true },
      extra: "allowed",
    };

    await tool.execute(input, {});

    const passedProps = runSpy.mock.calls[0][0].propsValue as Record<string, unknown>;
    expect(passedProps.text).toBe("hello");
    expect(passedProps.count).toBe(42);
    expect(passedProps.extra).toBe("allowed");
    expect(Object.prototype.hasOwnProperty.call(passedProps, "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(passedProps, "constructor")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(passedProps, "prototype")).toBe(false);
  });
});
