import { describe, it, expect } from "vitest";
import { ONIError } from "../errors.js";

/**
 * Regression test for BUG-0235.
 *
 * ONIError.toJSON() must include `stack` (string) and `context` (object) in
 * its return value.  Previously these fields were only present in
 * toInternalJSON(), so callers relying on toJSON() could not distinguish a
 * structured error from a plain one and stack-trace information was lost.
 */
describe("ONIError.toJSON() includes stack and context (BUG-0235)", () => {
  it("BUG-0235: toJSON() returns a stack field of type string", () => {
    const err = new ONIError("test error");
    const json = err.toJSON();
    expect(typeof json["stack"]).toBe("string");
    expect((json["stack"] as string).length).toBeGreaterThan(0);
  });

  it("BUG-0235: toJSON() returns a context field (object or undefined, not absent)", () => {
    const err = new ONIError("test error", { context: { foo: "bar" } });
    const json = err.toJSON();
    // The key must exist in the returned object
    expect(Object.prototype.hasOwnProperty.call(json, "context")).toBe(true);
    expect((json["context"] as Record<string, unknown>)["foo"]).toBe("bar");
  });

  it("BUG-0235: toJSON() context is present even when no context was supplied", () => {
    const err = new ONIError("no context");
    const json = err.toJSON();
    expect(Object.prototype.hasOwnProperty.call(json, "context")).toBe(true);
  });

  it("BUG-0235: toJSON() stack is a different value from the message field", () => {
    const err = new ONIError("distinct message");
    const json = err.toJSON();
    expect(json["stack"]).not.toBe(json["message"]);
    expect((json["stack"] as string)).toContain("distinct message");
  });

  it("BUG-0235: subclass toJSON() also includes stack and context", () => {
    const err = new ONIError("sub", {
      code: "ONI_TEST",
      category: "GRAPH",
      context: { key: 42 },
    });
    const json = err.toJSON();
    expect(typeof json["stack"]).toBe("string");
    expect((json["context"] as Record<string, unknown>)["key"]).toBe(42);
  });
});
