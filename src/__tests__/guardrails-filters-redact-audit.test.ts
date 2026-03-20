import { describe, it, expect } from "vitest";
import { runFilters, piiFilter, customFilter } from "../../src/guardrails/filters.js";

// BUG-0280 regression: when a filter returns blocked:true with a redacted value,
// the final result must include blockedBy and reason so callers have audit visibility.

describe("BUG-0280: redact-and-continue path preserves audit fields", () => {
  it("includes blockedBy and reason when first matching filter applies redaction", () => {
    const filters = [
      piiFilter({ block: ["email"], redact: true }),
    ];

    const result = runFilters(filters, "Contact alice@example.com for info", "input");

    expect(result.passed).toBe(true);
    expect(result.content).toContain("[EMAIL REDACTED]");
    // BUG-0280: blockedBy and reason must be present on redact path
    expect(result.blockedBy).toBeDefined();
    expect(typeof result.blockedBy).toBe("string");
  });

  it("records blockedBy from the first redacting filter when multiple filters run", () => {
    const redactingFilter = customFilter({
      name: "first-redactor",
      apply: "both",
      check: (content: string) => ({
        blocked: true,
        redacted: content.replace(/secret/gi, "[REDACTED]"),
        reason: "contains secret keyword",
      }),
    });
    const passingFilter = customFilter({
      name: "second-pass",
      apply: "both",
      check: () => ({ blocked: false }),
    });

    const result = runFilters(
      [redactingFilter, passingFilter],
      "the secret is here",
      "input",
    );

    expect(result.passed).toBe(true);
    expect(result.content).toBe("the [REDACTED] is here");
    expect(result.blockedBy).toBe("first-redactor");
    expect(result.reason).toBe("contains secret keyword");
  });

  it("does not set blockedBy when no filter applies redaction", () => {
    const filters = [
      piiFilter({ block: ["email"], redact: true }),
    ];

    const result = runFilters(filters, "no email here", "input");

    expect(result.passed).toBe(true);
    expect(result.blockedBy).toBeUndefined();
    expect(result.reason).toBeUndefined();
  });
});
