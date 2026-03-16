import { describe, it, expect } from "vitest";
import { deepMerge } from "../config/loader.js";

describe("BUG-0062: deepMerge prototype pollution guard", () => {
  it("BUG-0062: should not pollute Object.prototype via __proto__ key in override", () => {
    // Before the fix, deepMerge iterated Object.keys(override) without filtering
    // __proto__, constructor, or prototype keys. A malicious config containing
    // {"__proto__": {"isAdmin": true}} would pollute Object.prototype globally.
    const base = { a: 1 };
    const malicious = JSON.parse('{"__proto__": {"polluted": true}, "b": 2}');

    const result = deepMerge(base, malicious);

    // The __proto__ key must be silently skipped
    expect(result.b).toBe(2);
    expect(result.a).toBe(1);

    // Object.prototype must NOT be polluted
    const clean: Record<string, unknown> = {};
    expect(clean["polluted"]).toBeUndefined();
    expect(({} as any).polluted).toBeUndefined();
  });
});
