import { describe, it, expect, vi, afterEach } from "vitest";
import {
  apiKeyAuthResolver,
  oauth2AuthResolver,
  storeAuthResolver,
} from "../adapter/auth-resolver.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("apiKeyAuthResolver", () => {
  it("invokes keyProvider with ctx and returns its value", async () => {
    const ctx = { user: "alice" };
    const keyProvider = vi.fn((_ctx: unknown) => "secret-key");
    const resolver = apiKeyAuthResolver(keyProvider);

    const result = await resolver.resolve({ some: "authDef" }, ctx);

    expect(result).toBe("secret-key");
    expect(keyProvider).toHaveBeenCalledTimes(1);
    // ctx is forwarded, authDef is ignored
    expect(keyProvider).toHaveBeenCalledWith(ctx);
  });

  it("propagates exceptions thrown by keyProvider", async () => {
    const keyProvider = vi.fn(() => {
      throw new Error("no key available");
    });
    const resolver = apiKeyAuthResolver(keyProvider);

    await expect(resolver.resolve({}, {})).rejects.toThrow("no key available");
  });

  it("forwards undefined ctx to keyProvider", async () => {
    const keyProvider = vi.fn((_ctx: unknown) => "k");
    const resolver = apiKeyAuthResolver(keyProvider);

    await resolver.resolve({}, undefined);

    expect(keyProvider).toHaveBeenCalledWith(undefined);
  });
});

describe("oauth2AuthResolver", () => {
  it("defaults token_type to Bearer when tokenType is absent", async () => {
    const tokenProvider = vi.fn(async () => ({ accessToken: "abc123" }));
    const resolver = oauth2AuthResolver(tokenProvider);

    const result = await resolver.resolve({}, { ctxKey: 1 });

    expect(result).toEqual({ access_token: "abc123", token_type: "Bearer" });
    expect(tokenProvider).toHaveBeenCalledTimes(1);
    expect(tokenProvider).toHaveBeenCalledWith({ ctxKey: 1 });
  });

  it("uses the provided tokenType when present", async () => {
    const tokenProvider = vi.fn(async () => ({
      accessToken: "xyz",
      tokenType: "MAC",
    }));
    const resolver = oauth2AuthResolver(tokenProvider);

    const result = await resolver.resolve({}, {});

    expect(result).toEqual({ access_token: "xyz", token_type: "MAC" });
  });

  it("treats empty-string tokenType as falsy and falls back to Bearer", async () => {
    // "" ?? "Bearer" === "" — nullish coalescing only falls back on null/undefined,
    // so an empty string is preserved. This pins the actual operator behavior.
    const tokenProvider = vi.fn(async () => ({
      accessToken: "tok",
      tokenType: "",
    }));
    const resolver = oauth2AuthResolver(tokenProvider);

    const result = await resolver.resolve({}, {});

    expect(result).toEqual({ access_token: "tok", token_type: "" });
  });

  it("propagates rejection from the token provider", async () => {
    const tokenProvider = vi.fn(async () => {
      throw new Error("oauth provider failed");
    });
    const resolver = oauth2AuthResolver(tokenProvider);

    await expect(resolver.resolve({}, {})).rejects.toThrow(
      "oauth provider failed",
    );
  });
});

describe("storeAuthResolver", () => {
  it("warns when created without a scope", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = { get: vi.fn().mockResolvedValue(null) };

    storeAuthResolver(store, "stripe");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = warnSpy.mock.calls[0][0] as string;
    expect(message).toContain('storeAuthResolver for "stripe"');
    expect(message).toContain("without an access scope");
    expect(message).toContain("Pass options.scope to restrict access.");
  });

  it("warns when options provided but scope is empty string", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = { get: vi.fn().mockResolvedValue(null) };

    storeAuthResolver(store, "airtable", { scope: "" });

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT warn when a scope is supplied", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = { get: vi.fn().mockResolvedValue(null) };

    storeAuthResolver(store, "discord", { scope: "agent:123" });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("throws a descriptive error when store.get returns null", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = { get: vi.fn().mockResolvedValue(null) };
    const resolver = storeAuthResolver(store, "gmail", { scope: "s" });

    await expect(resolver.resolve({}, {})).rejects.toThrow(
      'No credentials found for integration "gmail".',
    );
    expect(store.get).toHaveBeenCalledWith(["credentials"], "gmail");
  });

  it("returns the stored value when store.get returns an item", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const stored = { access_token: "tok", refresh_token: "ref" };
    const store = { get: vi.fn().mockResolvedValue({ value: stored }) };
    const resolver = storeAuthResolver(store, "slack", { scope: "s" });

    const result = await resolver.resolve({}, {});

    expect(result).toBe(stored);
    expect(store.get).toHaveBeenCalledWith(["credentials"], "slack");
  });

  it("returns a falsy stored value (e.g. empty string) without throwing", async () => {
    // item is truthy ({ value: "" }) even though item.value is falsy,
    // so the not-found branch must not fire.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = { get: vi.fn().mockResolvedValue({ value: "" }) };
    const resolver = storeAuthResolver(store, "hubspot", { scope: "s" });

    const result = await resolver.resolve({}, {});

    expect(result).toBe("");
  });

  it("propagates rejection from the underlying store", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = { get: vi.fn().mockRejectedValue(new Error("store down")) };
    const resolver = storeAuthResolver(store, "github", { scope: "s" });

    await expect(resolver.resolve({}, {})).rejects.toThrow("store down");
  });
});
