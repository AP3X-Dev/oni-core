import { describe, it, expect } from "vitest";
import { buildVerifyPrompt, parseVerifyResponse } from "./verify-agent.js";
import type { Finding } from "./types.js";

const finding: Finding = {
  id: "test",
  severity: "warning",
  category: "security",
  file: "src/validation.ts",
  line: 28,
  issue: "eval() detected",
  source: "ast",
};

describe("verify-agent", () => {
  it("builds prompt with file context", () => {
    const context = '  { pattern: /\\beval\\s*\\(/, message: "eval() is a risk" },';
    const prompt = buildVerifyPrompt(finding, context);
    expect(prompt).toContain("src/validation.ts");
    expect(prompt).toContain("eval()");
    expect(prompt).toContain(context);
  });

  it("parses confirmed response", () => {
    const result = parseVerifyResponse('{"confirmed": true, "confidence": 0.9, "reason": "Real eval call"}');
    expect(result.confirmed).toBe(true);
    expect(result.confidence).toBe(0.9);
  });

  it("parses rejected response", () => {
    const result = parseVerifyResponse('{"confirmed": false, "confidence": 0.2, "reason": "This is a regex pattern, not actual eval usage"}');
    expect(result.confirmed).toBe(false);
    expect(result.confidence).toBe(0.2);
  });

  it("handles malformed JSON gracefully", () => {
    const result = parseVerifyResponse("not json at all");
    expect(result.confirmed).toBe(true); // default to keeping the finding
    expect(result.confidence).toBe(0.5);
  });
});
