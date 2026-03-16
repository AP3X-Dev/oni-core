import { describe, it, expect } from "vitest";
import { piiFilter } from "../guardrails/filters.js";

describe("BUG-0025: PII regex concurrency safety", () => {
  it("BUG-0025: should produce consistent results across repeated calls (no /g lastIndex corruption)", () => {
    // Before the fix, PII_PATTERNS used the /g flag, causing lastIndex to persist
    // between test() calls. With /g, calling pattern.test() alternates between
    // true and false on the same input because lastIndex advances past the match
    // and wraps around on the next call.
    const filter = piiFilter({ block: ["email", "ssn", "phone", "creditCard"] });
    const content = "Contact user@example.com or call (555) 123-4567";

    // Run the same check 20 times — with /g flag, results would alternate
    const results = Array.from({ length: 20 }, () => filter.check(content));

    // Every single call must detect PII — no intermittent misses
    for (let i = 0; i < results.length; i++) {
      expect(results[i].blocked, `call ${i} should detect PII`).toBe(true);
    }
  });
});
