/**
 * Regression test for BUG-0258:
 * storeAuthResolver() must emit a console.warn when created without an access
 * scope option, alerting developers that credentials are accessible without
 * scoping restrictions. The "not found" error must also be sanitized to avoid
 * disclosing store namespace paths or internal key formats.
 *
 * OWASP A02:2021 — Cryptographic Failures (credential enumeration risk).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { storeAuthResolver } from "../../packages/integrations/src/adapter/auth-resolver.js";
import type { SimpleStore } from "../../packages/integrations/src/adapter/auth-resolver.js";

function makeEmptyStore(): SimpleStore {
  return { get: async () => null };
}

function makePopulatedStore(key: string, value: unknown): SimpleStore {
  return {
    get: async (_ns, k) => k === key ? { value } : null,
  };
}

describe("BUG-0258: storeAuthResolver security — scope warning and sanitized errors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("BUG-0258: emits console.warn when no scope option is provided", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    storeAuthResolver(makeEmptyStore(), "stripe");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnMsg = warnSpy.mock.calls[0]?.[0] as string;
    expect(warnMsg).toContain("stripe");
    expect(warnMsg).toContain("scope");
  });

  it("does NOT emit console.warn when scope is provided", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    storeAuthResolver(makeEmptyStore(), "stripe", { scope: "integration:stripe" });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("BUG-0258: not-found error is sanitized — no store namespace path or internal key format", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const resolver = storeAuthResolver(makeEmptyStore(), "github", { scope: "integration:github" });

    let errorMsg = "";
    try {
      await resolver.resolve({}, {});
    } catch (err: unknown) {
      errorMsg = (err as Error).message;
    }

    expect(errorMsg).toBeTruthy();
    // Must name the integration for actionable error
    expect(errorMsg).toContain("github");
    // Must NOT disclose store internals or path structures
    expect(errorMsg).not.toMatch(/store\.put|store\.get|namespace\[|credentials:/i);
  });

  it("resolves existing credentials without warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const resolver = storeAuthResolver(
      makePopulatedStore("slack", { apiKey: "xoxb-test" }),
      "slack",
      { scope: "integration:slack" },
    );

    const result = await resolver.resolve({}, {});

    expect(result).toEqual({ apiKey: "xoxb-test" });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
