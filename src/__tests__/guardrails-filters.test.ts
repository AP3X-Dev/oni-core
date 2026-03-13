import { describe, it, expect } from "vitest";
import { piiFilter, topicFilter, customFilter, runFilters } from "../guardrails/filters.js";

describe("guardrails — content filters", () => {
  // ── PII filter ─────────────────────────────────────────────────

  describe("piiFilter", () => {
    it("blocks emails", () => {
      const filter = piiFilter({ block: ["email"] });
      const result = filter.check("Contact me at user@example.com for info");
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("email");
    });

    it("blocks SSNs", () => {
      const filter = piiFilter({ block: ["ssn"] });
      const result = filter.check("My SSN is 123-45-6789");
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("ssn");
    });

    it("blocks phone numbers", () => {
      const filter = piiFilter({ block: ["phone"] });
      const result = filter.check("Call me at (555) 123-4567");
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("phone");
    });

    it("blocks credit card numbers", () => {
      const filter = piiFilter({ block: ["creditCard"] });
      const result = filter.check("Card: 4111-1111-1111-1111");
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("creditCard");
    });

    it("passes clean content", () => {
      const filter = piiFilter({ block: ["email", "ssn", "phone", "creditCard"] });
      const result = filter.check("Hello, this is a normal message with no PII.");
      expect(result.blocked).toBe(false);
    });

    it("redacts PII when redact option is true", () => {
      const filter = piiFilter({ block: ["email"], redact: true });
      const result = filter.check("Email me at user@example.com please");
      expect(result.blocked).toBe(true);
      expect(result.redacted).toBe("Email me at [EMAIL REDACTED] please");
    });
  });

  // ── Topic filter ───────────────────────────────────────────────

  describe("topicFilter", () => {
    it("blocks messages containing blocked topics", () => {
      const filter = topicFilter({ blocked: ["violence", "weapons"] });
      const result = filter.check("Here is information about weapons manufacturing");
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("weapons");
    });

    it("is case-insensitive", () => {
      const filter = topicFilter({ blocked: ["gambling"] });
      const result = filter.check("Try this GAMBLING site!");
      expect(result.blocked).toBe(true);
    });

    it("passes clean content", () => {
      const filter = topicFilter({ blocked: ["violence", "weapons"] });
      const result = filter.check("The weather is nice today");
      expect(result.blocked).toBe(false);
    });
  });

  // ── Custom filter ──────────────────────────────────────────────

  describe("customFilter", () => {
    it("applies user-defined check function", () => {
      const filter = customFilter({
        name: "length",
        apply: "input",
        check: (content) => {
          if (content.length > 100) {
            return { blocked: true, reason: "Content too long" };
          }
          return { blocked: false };
        },
      });

      expect(filter.name).toBe("length");
      expect(filter.apply).toBe("input");

      const short = filter.check("short message");
      expect(short.blocked).toBe(false);

      const long = filter.check("a".repeat(101));
      expect(long.blocked).toBe(true);
      expect(long.reason).toBe("Content too long");
    });
  });

  // ── runFilters pipeline ────────────────────────────────────────

  describe("runFilters", () => {
    it("first block wins", () => {
      const filters = [
        topicFilter({ blocked: ["weapons"] }),
        piiFilter({ block: ["email"] }),
      ];

      const result = runFilters(filters, "Buy weapons at dealer@dark.net", "input");
      expect(result.passed).toBe(false);
      expect(result.blockedBy).toBe("topic");
      expect(result.reason).toContain("weapons");
    });

    it("passes when all filters are clean", () => {
      const filters = [
        topicFilter({ blocked: ["weapons"] }),
        piiFilter({ block: ["email", "ssn"] }),
      ];

      const result = runFilters(filters, "The weather is sunny and warm", "input");
      expect(result.passed).toBe(true);
      expect(result.content).toBe("The weather is sunny and warm");
    });

    it("applies redaction and continues pipeline", () => {
      const filters = [
        piiFilter({ block: ["email"], redact: true }),
        topicFilter({ blocked: ["weapons"] }),
      ];

      const result = runFilters(filters, "Contact user@test.com for details", "input");
      // PII filter redacts (does not block), topic filter passes
      expect(result.passed).toBe(true);
      expect(result.content).toBe("Contact [EMAIL REDACTED] for details");
    });

    it("respects direction filtering", () => {
      const inputOnly = customFilter({
        name: "input-only",
        apply: "input",
        check: () => ({ blocked: true, reason: "always blocks" }),
      });

      // Should block on input direction
      const inputResult = runFilters([inputOnly], "test", "input");
      expect(inputResult.passed).toBe(false);

      // Should pass on output direction (filter doesn't apply)
      const outputResult = runFilters([inputOnly], "test", "output");
      expect(outputResult.passed).toBe(true);
    });

    it("both direction filters apply to input and output", () => {
      const bothFilter = customFilter({
        name: "both-dir",
        apply: "both",
        check: (content) => {
          if (content.includes("blocked")) return { blocked: true, reason: "blocked word" };
          return { blocked: false };
        },
      });

      expect(runFilters([bothFilter], "this is blocked", "input").passed).toBe(false);
      expect(runFilters([bothFilter], "this is blocked", "output").passed).toBe(false);
      expect(runFilters([bothFilter], "this is fine", "input").passed).toBe(true);
    });
  });
});
